import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { generateApiKey } from "@/server/api-keys";

/**
 * 008 — Configuración del formulario del sitio por organización: orígenes
 * autorizados (CORS) y la clave `vsk_` (tabla `bot_api_key`, scope "site").
 * Todo filtra por la organización recibida; el control de rol lo pone la ruta
 * (`withAdminAuth`).
 */

/** Orígenes autorizados de una organización ([] si nunca se configuraron). */
export async function getAllowedOrigins(organizationId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ allowedOrigins: schema.siteRequestConfig.allowedOrigins })
    .from(schema.siteRequestConfig)
    .where(scoped(schema.siteRequestConfig.organizationId, organizationId))
    .limit(1);
  return rows[0]?.allowedOrigins ?? [];
}

/* ------------------- caché del preflight (en memoria) ------------------- */

/** Vida de una respuesta cacheada del preflight y tope de entradas. */
export const ORIGIN_CACHE_TTL_MS = 30_000;
export const ORIGIN_CACHE_MAX = 1_000;

const globalForSite = globalThis as unknown as {
  __siteOriginCache?: Map<string, { allowed: boolean; expires: number }>;
};

function originCache(): Map<string, { allowed: boolean; expires: number }> {
  return (globalForSite.__siteOriginCache ??= new Map());
}

/** Resultado cacheado (true/false) o undefined si no está o caducó. */
export function cachedOriginRegistered(origin: string, now: number = Date.now()): boolean | undefined {
  const cache = originCache();
  const hit = cache.get(origin);
  if (!hit) return undefined;
  if (hit.expires <= now) {
    cache.delete(origin);
    return undefined;
  }
  return hit.allowed;
}

/** Guarda un resultado; con el tope lleno expulsa la entrada más antigua. */
export function cacheOriginRegistered(origin: string, allowed: boolean, now: number = Date.now()): void {
  const cache = originCache();
  cache.delete(origin);
  while (cache.size >= ORIGIN_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(origin, { allowed, expires: now + ORIGIN_CACHE_TTL_MS });
}

/** Vacía la caché (al guardar orígenes: el cambio vale al instante en este proceso). */
export function clearOriginCache(): void {
  originCache().clear();
}

/** Entradas en la caché (tests). */
export function originCacheSize(): number {
  return originCache().size;
}

/** Guarda los orígenes (ya normalizados) de la organización. */
export async function setAllowedOrigins(
  organizationId: string,
  origins: readonly string[]
): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(schema.siteRequestConfig)
    .values({
      id: newId("siteRequestConfig"),
      organizationId,
      allowedOrigins: [...origins],
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.siteRequestConfig.organizationId,
      set: { allowedOrigins: [...origins], updatedAt: now },
    });
  clearOriginCache();
}

/**
 * ¿Alguna organización autoriza este origen? Solo para el preflight CORS, que
 * no trae la clave (el navegador no la manda): el POST vuelve a comprobar el
 * origen contra la organización DE LA CLAVE. Tabla de una fila por organización.
 */
export async function isOriginRegistered(origin: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.siteRequestConfig.id })
    .from(schema.siteRequestConfig)
    .where(sql`${origin} = any(${schema.siteRequestConfig.allowedOrigins})`)
    .limit(1);
  return rows.length > 0;
}

export type SiteKeyInfo = {
  id: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/** La clave activa del sitio (sin hash ni texto plano), o null. */
export async function getActiveSiteKey(organizationId: string): Promise<SiteKeyInfo | null> {
  const rows = await getDb()
    .select({
      id: schema.botApiKey.id,
      keyPrefix: schema.botApiKey.keyPrefix,
      createdAt: schema.botApiKey.createdAt,
      lastUsedAt: schema.botApiKey.lastUsedAt,
    })
    .from(schema.botApiKey)
    .where(
      scoped(
        schema.botApiKey.organizationId,
        organizationId,
        eq(schema.botApiKey.scope, "site"),
        isNull(schema.botApiKey.revokedAt)
      )
    )
    .orderBy(desc(schema.botApiKey.createdAt))
    .limit(1);
  const k = rows[0];
  return k
    ? {
        id: k.id,
        keyPrefix: k.keyPrefix,
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      }
    : null;
}

/** Revoca las claves activas del sitio de la organización. Devuelve cuántas. */
async function revokeActive(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  organizationId: string
): Promise<number> {
  const revoked = await tx
    .update(schema.botApiKey)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.botApiKey.organizationId, organizationId),
        eq(schema.botApiKey.scope, "site"),
        isNull(schema.botApiKey.revokedAt)
      )
    )
    .returning({ id: schema.botApiKey.id });
  return revoked.length;
}

/**
 * Crea la clave del sitio y revoca la anterior en la MISMA transacción (crear
 * = rotar: una sola clave activa por organización). El texto plano sale aquí
 * y en ningún otro sitio.
 */
export async function rotateSiteKey(
  organizationId: string,
  userId: string
): Promise<{ id: string; keyPrefix: string; key: string; revoked: number }> {
  const key = generateApiKey("site");
  const id = newId("botApiKey");
  const revoked = await getDb().transaction(async (tx) => {
    const n = await revokeActive(tx, organizationId);
    await tx.insert(schema.botApiKey).values({
      id,
      organizationId,
      scope: "site",
      label: "sitio web",
      keyPrefix: key.prefix,
      keyHash: key.hash,
      createdBy: userId,
    });
    return n;
  });
  return { id, keyPrefix: key.prefix, key: key.plain, revoked };
}

/** Revoca la clave del sitio (idempotente). */
export async function revokeSiteKey(organizationId: string): Promise<number> {
  return getDb().transaction((tx) => revokeActive(tx, organizationId));
}
