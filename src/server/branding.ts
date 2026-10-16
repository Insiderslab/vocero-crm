import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  DEFAULT_BRANDING,
  normalizeBranding,
  type Branding,
} from "@/lib/branding";

/** Marca guardada en organization.metadata (JSON de Better Auth). */

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Marca + a qué organización pertenece.
 *
 * El icono se guarda como archivo en `MEDIA_DIR/{organizationId}/favicon`, así
 * que servirlo necesita el id — y la ruta que lo sirve es pública (el login
 * también tiene pestaña), donde no hay sesión de la que sacarlo.
 */
type OrgRow = { id: string; metadata: string | null };

/**
 * CRM-1: sin sesión (login, layout raíz, favicon) la marca es la de la
 * INSTANCIA, nunca la de una organización cualquiera. Antes era `limit(1)` sin
 * orden: con varias organizaciones, cualquiera veía la marca de una al azar y
 * el login mostraba la equivocada.
 * - BRANDING_ORGANIZATION_ID configurado → esa organización;
 * - una sola organización en la instancia → la suya (el caso de siempre);
 * - varias y nada configurado → la marca por defecto.
 */
async function instanceOrganization(): Promise<OrgRow | null> {
  const db = getDb();
  const configured = getEnv().BRANDING_ORGANIZATION_ID;
  if (configured) {
    const rows = await db
      .select({ id: schema.organization.id, metadata: schema.organization.metadata })
      .from(schema.organization)
      .where(eq(schema.organization.id, configured))
      .limit(1);
    return rows[0] ?? null;
  }
  const rows = await db
    .select({ id: schema.organization.id, metadata: schema.organization.metadata })
    .from(schema.organization)
    .orderBy(asc(schema.organization.createdAt))
    .limit(2);
  return rows.length === 1 ? rows[0]! : null;
}

export async function getBrandingContext(
  organizationId?: string | null
): Promise<{ organizationId: string | null; branding: Branding }> {
  const row = organizationId
    ? ((
        await getDb()
          .select({ id: schema.organization.id, metadata: schema.organization.metadata })
          .from(schema.organization)
          .where(eq(schema.organization.id, organizationId))
          .limit(1)
      )[0] ?? null)
    : await instanceOrganization();
  if (!row) return { organizationId: null, branding: DEFAULT_BRANDING };
  const meta = parseMetadata(row.metadata);
  return {
    organizationId: row.id,
    branding: normalizeBranding(
      (meta.branding as Partial<Branding> | undefined) ?? null
    ),
  };
}

export async function getBranding(
  organizationId?: string | null
): Promise<Branding> {
  return (await getBrandingContext(organizationId)).branding;
}

export async function saveBranding(
  organizationId: string,
  branding: Branding
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  meta.branding = normalizeBranding(branding);
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
}
