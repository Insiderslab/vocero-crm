import { getEnv } from "@/lib/env";

/**
 * Cliente propio de la Graph API de Meta (WhatsApp Cloud API).
 * Única frontera de salida hacia Meta (Constitución II): todo request pasa
 * por graphRequest. En self-test, META_GRAPH_BASE_URL apunta al wa-mock.
 *
 * Fase 4 (custom heili.cloud): si WAPI_BASE_URL existe, el transporte se
 * desvía al gateway propio Wapi (mismo "dialecto Graph", bearer = API key de
 * Wapi; el token Meta jamás sale de Wapi). Sin WAPI_BASE_URL, comportamiento
 * idéntico al anterior (Meta directo / wa-mock).
 */

/** Transporte resuelto: a dónde va el request y con qué bearer. */
export type GraphTransport = { baseUrl: string; token: string };

/**
 * Decide el transporte para una llamada Graph. El desvío a Wapi requiere
 * organizationId (enrutado por org): llamadas sin org (wizard de conexión)
 * siguen yendo a Meta directo. WAPI_ORG_IDS (csv) limita el desvío a esas
 * orgs; ausente/vacía = todas.
 */
export function resolveGraphTransport(
  token: string,
  organizationId?: string
): GraphTransport {
  const env = getEnv();
  if (env.WAPI_BASE_URL && env.WAPI_API_KEY && organizationId) {
    const allowlist = (env.WAPI_ORG_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowlist.length === 0 || allowlist.includes(organizationId)) {
      return { baseUrl: env.WAPI_BASE_URL, token: env.WAPI_API_KEY };
    }
  }
  return { baseUrl: env.META_GRAPH_BASE_URL, token };
}

export class MetaApiError extends Error {
  status: number;
  code: number | null;
  type: string | null;
  details: unknown;

  constructor(
    message: string,
    opts: { status: number; code?: number | null; type?: string | null; details?: unknown }
  ) {
    super(message);
    this.name = "MetaApiError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.type = opts.type ?? null;
    this.details = opts.details;
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
  const transport = resolveGraphTransport(opts.token, opts.organizationId);
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
