import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Autenticación de la API de servicio `/api/bot/*`.
 *
 * Esta superficie NO la consume el navegador: la consume un cerebro externo
 * (un microservicio propio del operador) que quiere conducir la conversación
 * sin que el token de WhatsApp salga del CRM. Header `X-API-Key`.
 *
 * Dos tipos de clave:
 * - Clave POR organización (`vbk_…`, tabla `bot_api_key`): la organización se
 *   deriva de la clave. Es la única válida cuando la instancia tiene más de
 *   una organización (custom heili.cloud, multi-org).
 * - Clave de instancia heredada (`BOT_API_KEY` en env): solo vale si la
 *   instancia tiene exactamente UNA organización. Con varias se rechaza
 *   siempre — antes se elegía una organización arbitraria (`limit(1)` sin orden).
 */

export const BOT_KEY_PREFIX = "vbk_";

/** Límite común de toda la superficie `/api/bot/*`. null = dentro del límite. */
function botRateLimited(): Response | null {
  const rl = checkRateLimit("bot-api", { windowMs: 60_000, max: 600 });
  return rl.allowed ? null : apiError(429, "rate_limited", "Demasiadas solicitudes");
}

/** Comprueba la clave de instancia heredada (`BOT_API_KEY`). null = válida. */
export function requireBotKey(req: Request): Response | null {
  const limited = botRateLimited();
  if (limited) return limited;

  const expected = process.env.BOT_API_KEY;
  const provided = req.headers.get("x-api-key");
  if (!expected || expected.length < 16 || !provided) {
    return apiError(401, "unauthorized", "No autorizado");
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return apiError(401, "unauthorized", "No autorizado");
  }
  return null;
}

/** SHA-256 hex de una clave de bot (las claves son aleatorias de 32 bytes). */
export function hashBotKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Genera una clave nueva: texto plano (mostrar una vez), prefijo visible y hash. */
export function generateBotKey(): { plain: string; prefix: string; hash: string } {
  const plain = `${BOT_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { plain, prefix: plain.slice(0, 12), hash: hashBotKey(plain) };
}

/** Acceso a datos inyectable (los tests usan dobles sin base de datos). */
export type BotAuthDeps = {
  findActiveKey(hash: string): Promise<{ id: string; organizationId: string } | null>;
  touchKey(id: string): Promise<void>;
  listOrganizationIds(limit: number): Promise<string[]>;
};

export const dbBotAuthDeps: BotAuthDeps = {
  async findActiveKey(hash) {
    const rows = await getDb()
      .select({ id: schema.botApiKey.id, organizationId: schema.botApiKey.organizationId })
      .from(schema.botApiKey)
      .where(and(eq(schema.botApiKey.keyHash, hash), isNull(schema.botApiKey.revokedAt)))
      .limit(1);
    return rows[0] ?? null;
  },
  async touchKey(id) {
    await getDb()
      .update(schema.botApiKey)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.botApiKey.id, id));
  },
  async listOrganizationIds(limit) {
    const rows = await getDb()
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .orderBy(schema.organization.createdAt)
      .limit(limit);
    return rows.map((r) => r.id);
  },
};

export type BotAuthResult = { organizationId: string; keyId: string | null };

/**
 * Puerta única de `/api/bot/*`: autentica y devuelve la organización.
 * Devuelve un Response (401/409/429) cuando no se puede continuar.
 */
export async function authenticateBot(
  req: Request,
  deps: BotAuthDeps = dbBotAuthDeps
): Promise<BotAuthResult | Response> {
  const provided = req.headers.get("x-api-key") ?? "";

  if (provided.startsWith(BOT_KEY_PREFIX)) {
    const limited = botRateLimited();
    if (limited) return limited;
    const key = await deps.findActiveKey(hashBotKey(provided));
    if (!key) return apiError(401, "unauthorized", "No autorizado");
    // Registro de uso best-effort: un fallo aquí no debe tumbar la petición.
    deps.touchKey(key.id).catch(() => {});
    return { organizationId: key.organizationId, keyId: key.id };
  }

  const denied = requireBotKey(req);
  if (denied) return denied;

  // Clave de instancia: solo con una única organización. Se piden dos filas
  // para distinguir "una" de "varias" sin contar toda la tabla.
  const orgIds = await deps.listOrganizationIds(2);
  if (orgIds.length === 0) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }
  if (orgIds.length > 1) {
    return apiError(
      401,
      "instance_key_multi_org",
      "Con varias organizaciones la clave de instancia no es válida: usa una clave de bot de la organización"
    );
  }
  return { organizationId: orgIds[0]!, keyId: null };
}
