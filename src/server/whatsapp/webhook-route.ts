import { and, count, eq, gte, max, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import {
  classifyWebhookRoute,
  expectedWebhookUrl,
  webhookRouteAlarming,
  type WebhookConfiguration,
  type WebhookRouteCheck,
} from "@/lib/webhook-route";
import { getMetaPlatformIds, META_WEBHOOK_FIELDS } from "@/server/platform/meta-config";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

/**
 * 014 — Guardia del webhook (lato server).
 *
 * - `checkWebhookRoute`: chiede a Meta dove manda gli eventi del numero
 *   dell'organizzazione (con il token dell'organizzazione) e lo classifica.
 *   Risultato in memoria per CACHE_TTL_MS: aprire la pagina non martella Meta.
 * - `startWebhookRouteWatch` (da instrumentation): ogni ora rifà il controllo
 *   per tutte le organizzazioni collegate e scrive nei log quando un numero
 *   smette (o torna) di arrivare al CRM.
 * - `restoreAppWebhook`: rimette il CRM come callback dell'APP Meta (lo stesso
 *   di `ripristina-webhook.sh`, senza terminale). Solo super-admin: l'app è
 *   della piattaforma, non di un'organizzazione.
 *
 * Nessun segreto esce di qui: né il token del webhook, né l'App Secret, né il
 * percorso dell'indirizzo estraneo (solo l'host).
 */

export const CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { at: number; check: WebhookRouteCheck };

const globalForGuard = globalThis as unknown as {
  __webhookRouteCache?: Map<string, CacheEntry>;
};

function cache(): Map<string, CacheEntry> {
  if (!globalForGuard.__webhookRouteCache) globalForGuard.__webhookRouteCache = new Map();
  return globalForGuard.__webhookRouteCache;
}

/** Per i test e dopo un ripristino: il prossimo controllo va da Meta. */
export function clearWebhookRouteCache(): void {
  cache().clear();
}

function expectedUrl(): string {
  const env = getEnv();
  return expectedWebhookUrl(env.APP_BASE_URL, env.META_WEBHOOK_VERIFY_TOKEN);
}

function logTransition(organizationId: string, number: string, prev: WebhookRouteCheck | undefined, next: WebhookRouteCheck) {
  const wasAlarm = webhookRouteAlarming(prev);
  const isAlarm = webhookRouteAlarming(next);
  if (isAlarm && (!wasAlarm || prev?.foreignHost !== next.foreignHost || prev?.state !== next.state)) {
    console.warn(
      `[webhook-guard] org ${organizationId} numero ${number}: Meta NON manda gli eventi al CRM ` +
        `(stato ${next.state}, livello ${next.level ?? "-"}, host ${next.foreignHost ?? "-"})`
    );
  } else if (!isAlarm && wasAlarm && next.state === "ok") {
    console.log(`[webhook-guard] org ${organizationId} numero ${number}: Meta manda di nuovo gli eventi al CRM`);
  }
}

/**
 * Dove manda Meta gli eventi del numero dell'organizzazione. null se
 * l'organizzazione non ha un numero collegato.
 */
export async function checkWebhookRoute(
  organizationId: string,
  opts: { maxAgeMs?: number } = {}
): Promise<WebhookRouteCheck | null> {
  const prev = cache().get(organizationId);
  const maxAge = opts.maxAgeMs ?? CACHE_TTL_MS;
  if (prev && Date.now() - prev.at < maxAge) return prev.check;

  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    cache().delete(organizationId);
    return null;
  }
  const env = getEnv();
  let check: WebhookRouteCheck;
  if (env.WAPI_BASE_URL) {
    // Con il gateway Wapi il webhook lo gestisce il gateway: qui non si giudica.
    check = classifyWebhookRoute(undefined, expectedUrl());
    check = { ...check, reason: "wapi_gateway" };
  } else {
    try {
      const res = await graphRequest<{ webhook_configuration?: WebhookConfiguration }>(
        `${creds.phoneNumberId}?fields=webhook_configuration`,
        { token: creds.token, organizationId }
      );
      check = classifyWebhookRoute(res?.webhook_configuration, expectedUrl());
    } catch (err) {
      console.warn(
        `[webhook-guard] org ${organizationId}: controllo non riuscito (${
          err instanceof MetaApiError ? `Meta ${err.status}` : "errore"
        })`
      );
      check = { ...classifyWebhookRoute(undefined, expectedUrl()), reason: "meta_error" };
    }
  }
  logTransition(organizationId, creds.displayPhoneNumber ?? creds.phoneNumberId, prev?.check, check);
  cache().set(organizationId, { at: Date.now(), check });
  return check;
}

/**
 * Messaggi in entrata veri (non Laboratorio) degli ultimi 14 giorni e
 * l'ultimo arrivato: bastano per dire se il silenzio è insolito.
 */
export async function inboundStats(
  organizationId: string,
  now: Date = new Date()
): Promise<{ inbound14d: number; lastInboundAt: string | null }> {
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const m = schema.message;
  const c = schema.conversation;
  const rows = await getDb()
    .select({ n: count(), last: max(m.createdAt) })
    .from(m)
    .innerJoin(c, and(eq(c.id, m.conversationId), eq(c.organizationId, m.organizationId)))
    .where(scoped(m.organizationId, organizationId, eq(m.direction, "in"), gte(m.createdAt, since), sql`${c.isTest} = false`));
  const last = rows[0]?.last;
  return {
    inbound14d: Number(rows[0]?.n ?? 0),
    lastInboundAt: last ? new Date(last).toISOString() : null,
  };
}

/** Organizzazioni con un numero collegato (per il giro orario). */
async function connectedOrganizations(): Promise<string[]> {
  const rows = await getDb()
    .select({ organizationId: schema.metaCredentials.organizationId })
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.status, "connected"));
  return rows.map((r) => r.organizationId);
}

export async function runWebhookRouteWatch(): Promise<void> {
  for (const organizationId of await connectedOrganizations()) {
    await checkWebhookRoute(organizationId, { maxAgeMs: 0 }).catch((err) =>
      console.error(`[webhook-guard] org ${organizationId}: giro fallito`, err instanceof Error ? err.message : err)
    );
  }
}

export const WATCH_DEFAULT_MS = 60 * 60 * 1000;

/** Giro orario in-process (come lo scheduler delle automazioni). */
export function startWebhookRouteWatch(): void {
  const env = getEnv();
  if (env.WAPI_BASE_URL) return;
  const everyMs = Number(process.env.WEBHOOK_ROUTE_CHECK_MS ?? "") || WATCH_DEFAULT_MS;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void runWebhookRouteWatch()
      .catch((err) => console.error("[webhook-guard] giro fallito:", err instanceof Error ? err.message : err))
      .finally(() => {
        running = false;
      });
  };
  // Primo giro poco dopo l'avvio (il DB e le migrazioni sono pronti), poi ogni ora.
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, everyMs);
  if (typeof first.unref === "function") first.unref();
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[boot] guardia del webhook WhatsApp ogni ${everyMs / 1000}s`);
}

export type RestoreResult =
  | { ok: true }
  | { ok: false; code: "no_app_id" | "no_app_secret" | "wapi_gateway" | "meta_rejected"; message?: string };

/** Toglie dal messaggio di Meta qualunque segreto nostro (difesa in profondità). */
export function scrubSecrets(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join("<nascosto>");
  }
  return out.slice(0, 300);
}

/**
 * Rimette il CRM come callback dell'app Meta (`POST {app-id}/subscriptions`
 * con il token dell'app). Meta verifica subito l'indirizzo con una GET al
 * nostro webhook: se risponde «success», gli eventi tornano al CRM.
 * Sostituisce qualunque altro callback (n8n, ecc.): lo decide il super-admin.
 */
export async function restoreAppWebhook(): Promise<RestoreResult> {
  const env = getEnv();
  if (env.WAPI_BASE_URL) return { ok: false, code: "wapi_gateway" };
  const secret = env.META_APP_SECRET?.trim();
  if (!secret) return { ok: false, code: "no_app_secret" };
  const appId = (await getMetaPlatformIds()).appId.value;
  if (!appId) return { ok: false, code: "no_app_id" };
  try {
    const res = await graphRequest<{ success?: boolean }>(`${appId}/subscriptions`, {
      method: "POST",
      token: `${appId}|${secret}`,
      body: {
        object: "whatsapp_business_account",
        callback_url: expectedUrl(),
        verify_token: env.META_WEBHOOK_VERIFY_TOKEN,
        fields: META_WEBHOOK_FIELDS.join(","),
      },
    });
    if (!res?.success) {
      return { ok: false, code: "meta_rejected" };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "errore";
    return {
      ok: false,
      code: "meta_rejected",
      message: scrubSecrets(message, [secret, env.META_WEBHOOK_VERIFY_TOKEN]),
    };
  }
  clearWebhookRouteCache();
  console.log("[webhook-guard] callback dell'app rimesso sul CRM da un super-admin");
  return { ok: true };
}
