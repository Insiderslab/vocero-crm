import { and, count, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { messagesFor } from "@/lib/i18n/messages";
import { translate } from "@/lib/i18n/t";
import { defaultCurrencyFor } from "@/lib/money";
import { seedStages } from "@/lib/stages";

/** Transacción de Drizzle sobre nuestra conexión (la que entrega db.transaction). */
export type DbTx = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

/**
 * Provisiona una organización nueva: etapas sembradas del pipeline + perfil
 * del agente. La usan el primer registro de la instancia y el panel admin
 * (custom multi-org). NO crea la org ni la membresía — eso lo hace el caller
 * en la misma transacción.
 *
 * 009 (E2): `locale` es el idioma de quien la crea. Las etapas nacen en ese
 * idioma y la moneda de la marca se deduce de él (italiano → EUR); antes
 * todo nacía en español y en pesos mexicanos.
 */
export async function provisionOrganization(
  tx: DbTx,
  orgId: string,
  locale: Locale = DEFAULT_LOCALE
) {
  await tx.insert(schema.pipelineStage).values(
    seedStages(locale).map((s, i) => ({
      id: newId("stage"),
      organizationId: orgId,
      name: s.name,
      position: i,
      kind: s.kind,
    }))
  );
  await tx.insert(schema.agentProfile).values({
    id: newId("agentProfile"),
    organizationId: orgId,
  });
  // La moneda es un dato de la organización: se fija al nacer y se cambia en
  // Ajustes → Marca. Solo se escribe en una organización recién creada (sin
  // metadata), nunca encima de una marca ya guardada.
  await tx
    .update(schema.organization)
    .set({
      metadata: JSON.stringify({ branding: { currency: defaultCurrencyFor(locale) } }),
    })
    .where(and(eq(schema.organization.id, orgId), isNull(schema.organization.metadata)));
}

/**
 * Primer registro de la instancia: crea la organización, deja al usuario como
 * propietario y siembra pipeline + perfil del agente.
 *
 * Solo actúa si NO existe ninguna organización (las cuentas de equipo las crea
 * el propietario y reciben su membresía explícita). Un advisory lock evita que
 * dos registros simultáneos en instancia vacía creen dos organizaciones.
 */
export async function onUserCreated(
  userId: string,
  userName: string,
  locale: Locale = DEFAULT_LOCALE
) {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Lock transaccional de "primer arranque" (clave arbitraria fija):
    // dos registros simultáneos en instancia vacía → solo uno crea la org.
    await tx.execute(sql`select pg_advisory_xact_lock(874201)`);
    const [orgs] = await tx
      .select({ n: count() })
      .from(schema.organization);
    if ((orgs?.n ?? 0) > 0) return;

    const orgId = newId("organization");
    await tx.insert(schema.organization).values({
      id: orgId,
      name: defaultOrgName(userName, locale),
      slug: "principal",
    });
    await tx.insert(schema.member).values({
      id: newId("member"),
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await provisionOrganization(tx, orgId, locale);
  });
}

/** Nombre inicial de la organización, en el idioma de quien se registra. */
export function defaultOrgName(userName: string, locale: Locale): string {
  const messages = messagesFor(locale) as Record<string, unknown>;
  return userName
    ? translate(messages, "common.defaultOrg.named", { name: userName })
    : translate(messages, "common.defaultOrg.unnamed");
}

/** Organización activa de un usuario (su primera membresía). */
export async function resolveActiveOrganizationId(
  userId: string
): Promise<string | null> {
  return (await resolveMembership(userId))?.organizationId ?? null;
}

export async function resolveMembership(
  userId: string,
  preferredOrganizationId?: string | null
): Promise<{ organizationId: string; role: string } | null> {
  const db = getDb();
  // Multi-org (custom): si la sesión trae una org activa y el usuario es
  // miembro de ella, manda esa. Si no (sesión vieja, org borrada), cae a la
  // primera membresía — el comportamiento de siempre.
  if (preferredOrganizationId) {
    const preferred = await db
      .select({
        organizationId: schema.member.organizationId,
        role: schema.member.role,
      })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.userId, userId),
          eq(schema.member.organizationId, preferredOrganizationId)
        )
      )
      .limit(1);
    if (preferred[0]) return preferred[0];
  }
  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}
