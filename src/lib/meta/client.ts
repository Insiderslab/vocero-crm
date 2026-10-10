import { getEnv } from "@/lib/env";
import { getWapiKeyByOrg } from "@/server/whatsapp/wapi-credentials";

/**
 * Cliente propio de la Graph API de Meta (WhatsApp Cloud API).
 * Única frontera de salida hacia Meta (Constitución II): todo request pasa
 * por graphRequest. En self-test, META_GRAPH_BASE_URL apunta al wa-mock.
 *
 * Fase 4 (custom heili.cloud): si WAPI_BASE_URL existe, el transporte se
 * desvía al gateway propio Wapi (mismo "dialecto Graph", bearer = API key de
 * Wapi; el token Meta jamás sale de Wapi). Sin WAPI_BASE_URL, comportamiento
 * idéntico al anterior (Meta directo / wa-mock).
 *
 * C3: la clave de Wapi es POR organización (cifrada en `wapi_credentials`).
 * La clave global de entorno (WAPI_API_KEY) solo sobrevive como modo
 * heredado de UNA sola organización; con ambigüedad se niega (fail-closed).
 */

/** Transporte resuelto: a dónde va el request y con qué bearer. */
export type GraphTransport = {
  baseUrl: string;
  token: string;
  /** "wapi": el bearer es una clave de Wapi; "meta": el token Meta. */
  via: "wapi" | "meta";
};

/** Decisión pura de enrutamiento (sin I/O): testeable sin base de datos. */
export type GraphRoute =
  | { kind: "meta" }
  | { kind: "wapi"; apiKey: string; source: "org" | "legacy_global" }
  | { kind: "blocked"; reason: "ambiguous_legacy" };

/**
 * Reglas (con WAPI_BASE_URL y organizationId):
 * 1. La organización tiene clave propia activa → Wapi con ESA clave.
 * 2. Sin clave propia: la clave global solo vale en modo heredado, es decir
 *    cuando WAPI_ORG_IDS contiene exactamente UNA organización y es esta.
 * 3. WAPI_ORG_IDS con varias organizaciones y esta incluida → bloqueada (no
 *    se sabe de quién es la clave global; jamás se usa la de otra).
 * 4. Cualquier otro caso → Meta directo con el token propio de la org.
 * Sin WAPI_BASE_URL o sin organizationId → Meta directo siempre.
 */
export function decideGraphRoute(input: {
  wapiBaseUrl?: string;
  organizationId?: string;
  orgKey: string | null;
  globalKey?: string;
  allowlist: string[];
}): GraphRoute {
  const { wapiBaseUrl, organizationId, orgKey, globalKey, allowlist } = input;
  if (!wapiBaseUrl || !organizationId) return { kind: "meta" };
  if (orgKey) return { kind: "wapi", apiKey: orgKey, source: "org" };
  if (globalKey && allowlist.includes(organizationId)) {
    return allowlist.length === 1
      ? { kind: "wapi", apiKey: globalKey, source: "legacy_global" }
      : { kind: "blocked", reason: "ambiguous_legacy" };
  }
  return { kind: "meta" };
}

export function parseWapiOrgIds(csv: string | undefined): string[] {
  return (csv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Aviso de arranque (sin secretos): WAPI_API_KEY definida con WAPI_ORG_IDS
 * vacía. Antes (pre-C3) esa combinación desviaba TODAS las organizaciones a
 * Wapi; ahora van DIRECTAS a Meta hasta tener clave propia. Devuelve el texto
 * del aviso o null. No lee ni imprime el valor de la clave: solo si existe.
 */
export function wapiLegacyConfigWarning(env: {
  WAPI_API_KEY?: string;
  WAPI_ORG_IDS?: string;
}): string | null {
  if (!env.WAPI_API_KEY?.trim()) return null;
  if (parseWapiOrgIds(env.WAPI_ORG_IDS).length > 0) return null;
  return "[boot] WAPI_API_KEY está definida pero WAPI_ORG_IDS está vacía: desde C3 ninguna organización usa la clave global y todas van directas a Meta con su token propio. Carga la clave Wapi de cada organización (Configuración → WhatsApp) o fija WAPI_ORG_IDS con UNA organización (docs/ops/rilascio-c3.md §1).";
}

/** Etiqueta de enrutamiento para la UI/API de estado (nunca incluye claves). */
export type GraphRoutingLabel = "own_key" | "legacy_global" | "blocked" | "direct";

/**
 * Cómo se enrutaría hoy una llamada de la organización, dado si tiene clave
 * propia activa. Sin I/O y sin exponer ninguna clave.
 */
export function describeGraphRouting(
  organizationId: string,
  hasOwnKey: boolean
): GraphRoutingLabel {
  const env = getEnv();
  const route = decideGraphRoute({
    wapiBaseUrl: env.WAPI_BASE_URL,
    organizationId,
    orgKey: hasOwnKey ? "presente" : null,
    globalKey: env.WAPI_API_KEY,
    allowlist: parseWapiOrgIds(env.WAPI_ORG_IDS),
  });
  if (route.kind === "blocked") return "blocked";
  if (route.kind === "meta") return "direct";
  return route.source === "org" ? "own_key" : "legacy_global";
}

const warned = new Set<string>();

/**
 * Decide el transporte para una llamada Graph. El desvío a Wapi requiere
 * organizationId (enrutado por org): llamadas sin org (wizard de conexión)
 * siguen yendo a Meta directo. Una clave propia ilegible, o una organización
 * bloqueada por configuración ambigua, lanzan MetaApiError (status 0, no es
 * error de auth): no se hace ninguna llamada y jamás se usa otra clave.
 */
export async function resolveGraphTransport(
  token: string,
  organizationId?: string
): Promise<GraphTransport> {
  const env = getEnv();
  let orgKey: string | null = null;
  if (env.WAPI_BASE_URL && organizationId) {
    try {
      orgKey = await getWapiKeyByOrg(organizationId);
    } catch {
      // Sin detalle del error (podría rozar el cifrado): solo la organización.
      console.error(`[wapi] no se pudo leer la clave Wapi de la org ${organizationId}`);
      throw new MetaApiError("Clave Wapi de la organización no disponible", {
        status: 0,
        reason: WAPI_KEY_MISSING,
      });
    }
  }
  const route = decideGraphRoute({
    wapiBaseUrl: env.WAPI_BASE_URL,
    organizationId,
    orgKey,
    globalKey: env.WAPI_API_KEY,
    allowlist: parseWapiOrgIds(env.WAPI_ORG_IDS),
  });
  if (route.kind === "blocked") {
    if (organizationId && !warned.has(organizationId)) {
      warned.add(organizationId);
      console.warn(
        `[wapi] org ${organizationId} bloqueada: WAPI_ORG_IDS tiene varias organizaciones y la clave global no se comparte. Configura una clave Wapi propia.`
      );
    }
    throw new MetaApiError(
      "Enrutamiento Wapi no permitido: la organización no tiene clave propia",
      { status: 0, reason: WAPI_KEY_MISSING }
    );
  }
  if (route.kind === "wapi") {
    return { baseUrl: env.WAPI_BASE_URL!, token: route.apiKey, via: "wapi" };
  }
  return { baseUrl: env.META_GRAPH_BASE_URL, token, via: "meta" };
}

/**
 * Motivo dedicado: la organización está bloqueada o su clave Wapi no se puede
 * leer. NO es una caída de Meta: las capas de servicio lo traducen al código
 * `wapi_key_missing` (sin exponer ninguna clave) en vez de "Meta no disponible".
 */
export const WAPI_KEY_MISSING = "wapi_key_missing" as const;
export const WAPI_KEY_MISSING_MESSAGE =
  "La clave Wapi de esta organización falta o no se puede leer: configúrala en Configuración → WhatsApp";

export class MetaApiError extends Error {
  status: number;
  reason: typeof WAPI_KEY_MISSING | null;
  code: number | null;
  type: string | null;
  details: unknown;

  constructor(
    message: string,
    opts: {
      status: number;
      code?: number | null;
      type?: string | null;
      details?: unknown;
      reason?: typeof WAPI_KEY_MISSING;
    }
  ) {
    super(message);
    this.name = "MetaApiError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.type = opts.type ?? null;
    this.details = opts.details;
    this.reason = opts.reason ?? null;
  }

  /** Organización bloqueada o clave Wapi ilegible (ver WAPI_KEY_MISSING). */
  get isWapiKeyMissing(): boolean {
    return this.reason === WAPI_KEY_MISSING;
  }

  /**
   * Token vencido/revocado → la conexión requiere re-autenticación.
   * Meta etiqueta como "OAuthException" también errores transitorios 5xx
   * (ej. código 2 "service temporarily unavailable"), así que el type por sí
   * solo NO basta: solo 401 o código 190, y jamás con status ≥ 500.
   */
  get isAuthError(): boolean {
    if (this.status >= 500) return false;
    return this.status === 401 || this.code === 190;
  }
}

export async function graphRequest<T>(
  path: string,
  opts: {
    method?: "GET" | "POST" | "DELETE";
    token: string;
    body?: unknown;
    /** Fase 4: org que origina la llamada (enruta el desvío a Wapi). */
    organizationId?: string;
  }
): Promise<T> {
  const env = getEnv();
  const transport = await resolveGraphTransport(
    opts.token,
    opts.organizationId
  );
  const url = `${transport.baseUrl}/${env.META_GRAPH_API_VERSION}/${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${transport.token}`,
        ...(opts.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Meta", {
      status: 0,
      details: cause,
    });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON: se conserva el texto crudo en details
  }

  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number; type?: string } })
      ?.error;
    throw new MetaApiError(err?.message ?? `Meta respondió ${res.status}`, {
      status: res.status,
      code: err?.code ?? null,
      type: err?.type ?? null,
      details: json ?? text,
    });
  }
  return json as T;
}

/**
 * Normaliza un número al formato canónico. Números móviles de México llegan
 * de Meta como `521` + 10 dígitos (13 en total); enviar con ese `1` extra
 * produce el error 131030 — se usa `52` + 10 dígitos.
 *
 * Desde la identidad resiliente (003) esta normalización es SIMÉTRICA: se
 * aplica también al escribir la identidad del contacto en la ingesta
 * (`wa_identity`), para que `521...` y `52...` resuelvan al mismo contacto.
 */
export function normalizeMx(phone: string): string {
  if (/^521\d{10}$/.test(phone)) {
    return `52${phone.slice(3)}`;
  }
  return phone;
}

/** Alias histórico (envío). */
export const normalizeRecipient = normalizeMx;
