import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { checkRateLimit, clientIp, isRateLimited } from "@/lib/rate-limit";

/**
 * Claves de servicio POR organización (una sola fuente para `/api/bot/*` y
 * `/api/export/*`). Tabla `bot_api_key` (nombre histórico de C1) con columna
 * `scope`: cada clave vale para UNA organización y UN ámbito.
 *
 * - Clave por organización (`vbk_…` bot, `vex_…` export): la organización se
 *   deriva de la clave. Se guarda solo el SHA-256; revocable; `last_used_at`.
 * - Clave de instancia heredada (env): solo vale si la instancia tiene
 *   exactamente UNA organización. Con varias se rechaza siempre.
 */

export type ApiKeyScope = "bot" | "export";

type ScopeConfig = {
  /** Prefijo visible del texto plano: distingue el ámbito antes de consultar. */
  prefix: string;
  /** Variable de entorno de la clave de instancia heredada. */
  instanceEnv: "BOT_API_KEY" | "EXPORT_API_KEY";
  /**
   * Límite por ventana. Se cuenta por organización (`<bucket>:org:<id>`), así
   * una organización no agota el límite de otra. Aparte, con el mismo límite:
   * `<bucket>:invalid:<ip>` (claves del ámbito que no existen o están
   * revocadas, por IP del cliente) y `<bucket>:instance` (clave de instancia
   * heredada).
   */
  rateLimit: { bucket: string; windowMs: number; max: number };
};

export const API_KEY_SCOPES: Record<ApiKeyScope, ScopeConfig> = {
  bot: {
    prefix: "vbk_",
    instanceEnv: "BOT_API_KEY",
    rateLimit: { bucket: "bot-api", windowMs: 60_000, max: 600 },
  },
  export: {
    prefix: "vex_",
    instanceEnv: "EXPORT_API_KEY",
    rateLimit: { bucket: "export-api", windowMs: 60_000, max: 300 },
  },
};

const tooMany = () => apiError(429, "rate_limited", "Demasiadas solicitudes");

/** Consume una solicitud del contador `<bucket>:<sub>` del ámbito. */
function rateLimited(scope: ApiKeyScope, sub: string): Response | null {
  const { bucket, windowMs, max } = API_KEY_SCOPES[scope].rateLimit;
  return checkRateLimit(`${bucket}:${sub}`, { windowMs, max }).allowed ? null : tooMany();
}

/** Comprueba la clave de instancia heredada del ámbito. null = válida. */
export function requireInstanceKey(req: Request, scope: ApiKeyScope): Response | null {
  const limited = rateLimited(scope, "instance");
  if (limited) return limited;

  const expected = process.env[API_KEY_SCOPES[scope].instanceEnv];
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

/** SHA-256 hex de una clave (las claves son aleatorias de 32 bytes). */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Genera una clave nueva del ámbito: texto plano (mostrar una vez), prefijo visible y hash. */
export function generateApiKey(scope: ApiKeyScope): { plain: string; prefix: string; hash: string } {
  const plain = `${API_KEY_SCOPES[scope].prefix}${randomBytes(32).toString("base64url")}`;
  return { plain, prefix: plain.slice(0, 12), hash: hashApiKey(plain) };
}

/** Acceso a datos inyectable (los tests usan dobles sin base de datos). */
export type ApiKeyAuthDeps = {
  findActiveKey(
    hash: string
  ): Promise<{ id: string; organizationId: string; scope: string } | null>;
  touchKey(id: string): Promise<void>;
  listOrganizationIds(limit: number): Promise<string[]>;
};

export const dbApiKeyAuthDeps: ApiKeyAuthDeps = {
  async findActiveKey(hash) {
    const rows = await getDb()
      .select({
        id: schema.botApiKey.id,
        organizationId: schema.botApiKey.organizationId,
        scope: schema.botApiKey.scope,
      })
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

export type ApiKeyAuthResult = { organizationId: string; keyId: string | null };

/**
 * Puerta única de una superficie de servicio: autentica y devuelve la
 * organización. Devuelve un Response (401/409/429) cuando no se puede seguir.
 */
export async function authenticateApiKey(
  req: Request,
  scope: ApiKeyScope,
  deps: ApiKeyAuthDeps = dbApiKeyAuthDeps
): Promise<ApiKeyAuthResult | Response> {
  const provided = req.headers.get("x-api-key") ?? "";

  if (provided.startsWith(API_KEY_SCOPES[scope].prefix)) {
    const { bucket, windowMs, max } = API_KEY_SCOPES[scope].rateLimit;
    // Claves inválidas: contador por IP del cliente, consultado antes de la
    // base de datos. Una avalancha solo bloquea a la IP que la envía; el resto
    // de IPs, y sus claves válidas, sigue entrando. Esa IP queda bloqueada
    // también con una clave válida: si no, la respuesta diría qué clave es
    // buena y el límite no frenaría la fuerza bruta.
    const invalid = `${bucket}:invalid:${clientIp(req.headers)}`;
    if (isRateLimited(invalid, { windowMs, max })) return tooMany();
    const key = await deps.findActiveKey(hashApiKey(provided));
    // Una clave de otro ámbito no vale aquí, aunque exista y esté activa.
    if (!key || key.scope !== scope) {
      checkRateLimit(invalid, { windowMs, max });
      return apiError(401, "unauthorized", "No autorizado");
    }
    // Límite propio de la organización de la clave.
    const limited = rateLimited(scope, `org:${key.organizationId}`);
    if (limited) return limited;
    // Registro de uso best-effort: un fallo aquí no debe tumbar la petición.
    deps.touchKey(key.id).catch(() => {});
    return { organizationId: key.organizationId, keyId: key.id };
  }

  const denied = requireInstanceKey(req, scope);
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
      "Con varias organizaciones la clave de instancia no es válida: usa una clave de la organización"
    );
  }
  return { organizationId: orgIds[0]!, keyId: null };
}
