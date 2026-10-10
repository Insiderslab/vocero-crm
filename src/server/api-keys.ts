import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { checkRateLimit, clientIp, countInWindow } from "@/lib/rate-limit";

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
   * Límite por ventana (`max`). Se cuenta por organización
   * (`<bucket>:org:<id>`), así una organización no agota el límite de otra.
   * Aparte: `<bucket>:instance` (clave de instancia, solo tras comparación
   * correcta) y dos contadores de FALLOS por IP del cliente, uno por tipo de
   * clave para que el tráfico sin prefijo (escáneres, IP compartidas) no
   * toque las claves por organización: `<bucket>:invalid:<ip>` (clave con
   * prefijo del ámbito, inexistente, revocada o de otro ámbito) y
   * `<bucket>:instance-invalid:<ip>` (el resto). Ver `ipFailureCounter`.
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

/**
 * Multiplicador del umbral duro de fallos por IP: umbral blando = `max`,
 * umbral duro = `max × INVALID_HARD_FACTOR`.
 */
export const INVALID_HARD_FACTOR = 4;

type FailureKind = "invalid" | "instance-invalid";

/**
 * Contador de FALLOS por IP del cliente, con dos umbrales (una sola fuente
 * para la clave de instancia y las claves por organización):
 *
 * - bajo el umbral blando (`max` fallos en la ventana): el fallo responde 401;
 * - entre el blando y el duro: el fallo responde 429, pero la clave se sigue
 *   VERIFICANDO, así una clave válida no queda bloqueada por los fallos de
 *   otros que comparten IP (NAT, IP de salida de plataformas de automatización,
 *   el valor "local" cuando no hay proxy). Coste acotado: la comparación de la
 *   clave de instancia es en memoria y la consulta de una clave por
 *   organización es por índice (hash);
 * - desde el umbral duro (`max × INVALID_HARD_FACTOR`): `hardBlocked`, el
 *   llamador responde 429 SIN comparar ni consultar la base de datos. Es el
 *   freno a la fuerza bruta y al coste de las consultas: una IP no puede hacer
 *   más de `max × INVALID_HARD_FACTOR` intentos por ventana.
 *
 * Solo los fallos consumen el contador; las claves válidas no.
 */
function ipFailureCounter(req: Request, scope: ApiKeyScope, kind: FailureKind) {
  const { bucket, windowMs, max } = API_KEY_SCOPES[scope].rateLimit;
  const key = `${bucket}:${kind}:${clientIp(req.headers)}`;
  const hardMax = max * INVALID_HARD_FACTOR;
  const failures = countInWindow(key, windowMs);
  return {
    hardBlocked: failures >= hardMax,
    /** Registra un fallo y devuelve la respuesta: 401 bajo el umbral blando, 429 desde él. */
    fail(): Response {
      checkRateLimit(key, { windowMs, max: hardMax });
      return failures >= max ? tooMany() : apiError(401, "unauthorized", "No autorizado");
    },
  };
}

/**
 * Comprueba la clave de instancia heredada del ámbito. null = válida.
 * Los fallos (sin cabecera, variable de entorno ausente o corta, comparación
 * errónea) cuentan por IP en `<bucket>:instance-invalid:<ip>`; el contador de
 * la instancia solo se consume tras una comparación correcta, así una
 * avalancha de claves falsas no bloquea la clave legítima (ni desde la misma
 * IP, hasta el umbral duro; ni desde otra).
 */
export function requireInstanceKey(req: Request, scope: ApiKeyScope): Response | null {
  const ip = ipFailureCounter(req, scope, "instance-invalid");
  if (ip.hardBlocked) return tooMany();

  const expected = process.env[API_KEY_SCOPES[scope].instanceEnv];
  const provided = req.headers.get("x-api-key");
  if (!expected || expected.length < 16 || !provided) return ip.fail();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return ip.fail();
  return rateLimited(scope, "instance");
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
    // Fallos por IP del cliente (ver `ipFailureCounter`): una avalancha solo
    // afecta a la IP que la envía, y esa IP sigue verificando su clave hasta
    // el umbral duro; pasado el cual se responde 429 sin consultar la base de datos.
    const ip = ipFailureCounter(req, scope, "invalid");
    if (ip.hardBlocked) return tooMany();
    const key = await deps.findActiveKey(hashApiKey(provided));
    // Una clave de otro ámbito no vale aquí, aunque exista y esté activa.
    if (!key || key.scope !== scope) return ip.fail();
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
  warnInstanceKeyInUse(scope);
  return { organizationId: orgIds[0]!, keyId: null };
}

const instanceKeyWarned = new Set<ApiKeyScope>();

/**
 * Transición de la clave de instancia heredada a las claves por organización:
 * un aviso por ámbito y proceso (nunca el valor de la clave). La clave de
 * instancia sigue valiendo con UNA organización, pero deja de valer en cuanto
 * se crea la segunda: quien la usa debe migrar antes de que eso pase.
 */
function warnInstanceKeyInUse(scope: ApiKeyScope): void {
  if (instanceKeyWarned.has(scope)) return;
  instanceKeyWarned.add(scope);
  const { instanceEnv, prefix } = API_KEY_SCOPES[scope];
  console.warn(
    `[api-keys] Se usó la clave de instancia heredada ${instanceEnv}: solo vale ` +
      `mientras la instancia tenga UNA organización y dejará de valer al crear la ` +
      `segunda. Crea una clave por organización (${prefix}…) en Configuración → ` +
      `Claves de API, cámbiala en tus scripts y retira ${instanceEnv} del entorno.`
  );
}

/** Solo tests: vuelve a permitir el aviso de la clave de instancia. */
export function resetInstanceKeyWarnings(): void {
  instanceKeyWarned.clear();
}
