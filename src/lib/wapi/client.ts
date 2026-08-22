import { getEnv } from "@/lib/env";
import { MetaApiError } from "@/lib/meta/client";
import type { Credentials } from "@/server/whatsapp/credentials";

/**
 * Fase 4 — Adaptador de salida hacia Wapi (https://whapi.heili.cloud).
 *
 * Wapi expone un proxy "Graph-shaped" en `/api/v1/graph/{version}/{...ruta}`
 * que habla EXACTAMENTE el dialecto de la Graph API de Meta: mismas rutas
 * (`{phone_number_id}/messages`, `{waba}/message_templates`, metadata de
 * media, etc.), mismo sobre de error `{ error: { message, code, type } }`.
 *
 * Diferencias con Meta:
 *   - Base URL: `${WAPI_BASE_URL}/api/v1/graph` en vez de graph.facebook.com.
 *   - Autenticación: `Authorization: Bearer <WAPI_API_KEY>` (la api key de la
 *     org en Wapi, `hlp_live_...`). El token real de Meta vive SOLO en Wapi;
 *     Wapi resuelve las credenciales por el phone_number_id/waba_id de la ruta.
 *
 * Como el sobre de error es idéntico al de Meta, este adaptador reutiliza
 * `MetaApiError`: la capa de envío (send.ts, templates.ts…) traduce los
 * errores con su lógica habitual sin cambios.
 */

/** Base del proxy Graph-shaped de Wapi. Requiere WAPI_BASE_URL en env. */
export function wapiGraphBase(): string {
  const env = getEnv();
  if (!env.WAPI_BASE_URL) {
    throw new MetaApiError("WAPI_BASE_URL no está configurada", { status: 0 });
  }
  return `${env.WAPI_BASE_URL.replace(/\/+$/, "")}/api/v1/graph`;
}

/** API key de Wapi usada como Bearer. Requiere WAPI_API_KEY en env. */
export function wapiApiKey(): string {
  const env = getEnv();
  if (!env.WAPI_API_KEY) {
    throw new MetaApiError("WAPI_API_KEY no está configurada", { status: 0 });
  }
  return env.WAPI_API_KEY;
}

/**
 * Espejo de `graphRequest` (src/lib/meta/client.ts) contra Wapi. Misma firma y
 * misma semántica de errores; el `path` es idéntico al que se enviaría a Meta
 * (ej. `671133866076775/messages`). El `token` es la api key de Wapi.
 */
export async function wapiRequest<T>(
  path: string,
  opts: {
    method?: "GET" | "POST" | "DELETE";
    token: string;
    body?: unknown;
  }
): Promise<T> {
  const env = getEnv();
  const url = `${wapiGraphBase()}/${env.META_GRAPH_API_VERSION}/${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        ...(opts.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Wapi", {
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
    throw new MetaApiError(err?.message ?? `Wapi respondió ${res.status}`, {
      status: res.status,
      code: err?.code ?? null,
      type: err?.type ?? null,
      details: json ?? text,
    });
  }
  return json as T;
}

/**
 * Espejo de `uploadGraphMedia` contra Wapi: `POST {phone_number_id}/media`
 * multipart. Wapi reenvía el cuerpo crudo a Meta y retransmite la respuesta.
 */
export async function uploadWapiMedia(
  credentials: Credentials,
  file: { data: Buffer | Uint8Array; mimeType: string; fileName?: string }
): Promise<string> {
  const env = getEnv();
  const url = `${wapiGraphBase()}/${env.META_GRAPH_API_VERSION}/${credentials.phoneNumberId}/media`;
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", file.mimeType);
  const bytes = new Uint8Array(file.data);
  form.set(
    "file",
    new Blob([bytes], { type: file.mimeType }),
    file.fileName ?? "adjunto"
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${wapiApiKey()}` },
      body: form,
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Wapi", {
      status: 0,
      details: cause,
    });
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number; type?: string } })
      ?.error;
    throw new MetaApiError(err?.message ?? `Wapi respondió ${res.status}`, {
      status: res.status,
      code: err?.code ?? null,
      type: err?.type ?? null,
      details: json ?? text,
    });
  }
  const id = (json as { id?: string })?.id;
  if (!id) {
    throw new MetaApiError("Wapi no devolvió ID del media subido", {
      status: res.status,
    });
  }
  return id;
}
