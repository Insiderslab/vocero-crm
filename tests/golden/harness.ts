import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, vi } from "vitest";
import { GOLDEN_HOSTS } from "./env";
import { getSql } from "@/lib/db";
import { subscribe } from "@/server/events/bus";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
// La ruta pública del webhook. En M1.3 (T029) pasa a
// `src/app/api/webhooks/[channel]/[webhookToken]/route.ts` con el slug `wa`:
// se cambia SOLO este import (y `params`), nunca los archivos __golden__.
import {
  GET as webhookGet,
  POST as webhookPost,
} from "@/app/api/webhooks/wa/[webhookToken]/route";
import { FIXED_NOW_MS, Normalizer, type Secrets } from "./normalize";
import {
  AI_TOKEN,
  ORG_A,
  ORG_B,
  ORGS,
  WAPI_KEY_A,
  resetDatabase,
  seedOrganizations,
} from "./setup";

/**
 * Arnés de los golden (T003/T005): llama a los gestores VERDADEROS con una
 * base de datos real y registra lo observable —filas, peticiones salientes,
 * eventos SSE, respuesta— en una instantánea normalizada.
 *
 * - `fetch` está interceptado: Graph (y Wapi, mismo dialecto) e IA responden
 *   desde aquí; cualquier otro host se bloquea y queda registrado.
 * - `after()` de Next se encola (setup-file.ts) y se ejecuta al terminar la
 *   respuesta, como en producción.
 * - `publish` se observa con `subscribe` (sin mocks del bus).
 */

/** El reloj real, capturado antes de congelar `Date` (para clasificar now() de PostgreSQL). */
const REAL_NOW_MS = Date.now();

export const GRAPH_BASE = `https://${GOLDEN_HOSTS.graph}`;
export const WAPI_BASE = `https://${GOLDEN_HOSTS.wapi}`;

type RecordedRequest = {
  to: string;
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
};

type Override = {
  to?: "graph" | "wapi";
  method?: string;
  path: RegExp;
  status: number;
  json: unknown;
  times: number;
};

type AfterTask = (() => unknown) | Promise<unknown>;

const g = globalThis as unknown as {
  __goldenAfter?: AfterTask[];
  __agentCoalesce?: Map<string, unknown>;
};

const state = {
  requests: [] as RecordedRequest[],
  sse: [] as { org: string; type: string; data: unknown }[],
  consoleErrors: 0,
  inflight: 0,
  seq: { out: 0, upload: 0 },
  overrides: [] as Override[],
  aiReplies: [] as string[],
  unsubscribe: [] as (() => void)[],
};

export function secrets(): Secrets {
  const out: Secrets = {
    [ORGS.A.token]: `meta_token(${ORG_A})`,
    [ORGS.B.token]: `meta_token(${ORG_B})`,
    [WAPI_KEY_A]: `wapi_key(${ORG_A})`,
    [AI_TOKEN]: "ai_token",
  };
  const verify = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (verify) out[verify] = "webhook_verify_token";
  const appSecret = process.env.META_APP_SECRET;
  if (appSecret) out[appSecret] = "meta_app_secret";
  return out;
}

/* ------------------------------ fetch falso ------------------------------ */

async function describeBody(body: unknown): Promise<unknown> {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  if (body instanceof FormData) {
    const entries: unknown[] = [];
    for (const [name, value] of body.entries()) {
      if (typeof value === "string") entries.push({ name, value });
      else entries.push({ name, file: { name: value.name, type: value.type, size: value.size } });
    }
    return { formData: entries };
  }
  return `<${Object.prototype.toString.call(body)}>`;
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function graphResponse(to: "graph" | "wapi", origin: string, method: string, p: string): Response {
  const override = state.overrides.find(
    (o) =>
      o.times > 0 &&
      (!o.to || o.to === to) &&
      (!o.method || o.method === method) &&
      o.path.test(p)
  );
  if (override) {
    override.times -= 1;
    return json(override.status, override.json);
  }
  let m: RegExpExecArray | null;
  if (method === "POST" && (m = /^\/v[\d.]+\/(\d+)\/messages$/.exec(p))) {
    state.seq.out += 1;
    return json(200, {
      messaging_product: "whatsapp",
      messages: [{ id: `wamid.golden.out.${state.seq.out}` }],
    });
  }
  if (method === "POST" && /^\/v[\d.]+\/(\d+)\/media$/.test(p)) {
    state.seq.upload += 1;
    return json(200, { id: `media.golden.up.${state.seq.upload}` });
  }
  if (method === "GET" && (m = /^\/files\/(.+)$/.exec(p))) {
    return new Response(Buffer.from(`golden-file:${m[1]}`), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  }
  if (method === "GET" && (m = /^\/v[\d.]+\/([^/]+)$/.exec(p))) {
    const id = decodeURIComponent(m[1] ?? "");
    if (id.includes("gone")) {
      return json(404, { error: { message: "Unsupported get request", code: 100, type: "GraphMethodException" } });
    }
    return json(200, {
      id,
      url: `${origin}/files/${encodeURIComponent(id)}`,
      mime_type: "application/octet-stream",
      file_size: `golden-file:${id}`.length,
    });
  }
  return json(404, { error: { message: `golden: ruta Graph no simulada ${method} ${p}`, code: 100 } });
}

function aiResponse(): Response {
  const content = state.aiReplies.shift() ?? '{"action":"none"}';
  return json(200, { choices: [{ message: { role: "assistant", content } }] });
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href);
  const method = (init?.method ?? "GET").toUpperCase();
  const auth = new Headers(init?.headers).get("authorization");
  const to =
    url.host === GOLDEN_HOSTS.graph
      ? "graph"
      : url.host === GOLDEN_HOSTS.wapi
        ? "wapi"
        : url.host === GOLDEN_HOSTS.ai
          ? "ai"
          : `BLOCKED:${url.host}`;
  const p = url.pathname + url.search;
  state.requests.push({ to, method, path: p, auth, body: await describeBody(init?.body) });
  state.inflight += 1;
  try {
    await Promise.resolve();
    if (to === "graph" || to === "wapi") return graphResponse(to, url.origin, method, p);
    if (to === "ai" && method === "POST" && url.pathname === "/api/v1/chat/completions") {
      return aiResponse();
    }
    // Ninguna red real desde los golden: el host queda en la instantánea.
    throw new TypeError(`golden: red bloqueada hacia ${url.host}`);
  } finally {
    state.inflight -= 1;
  }
}

/** Respuesta forzada de Graph/Wapi para las próximas `times` peticiones que coincidan. */
export function graphFails(o: Omit<Override, "times"> & { times?: number }): void {
  state.overrides.push({ times: 1, ...o });
}

/** Contenido que devolverá el proveedor de IA en las próximas llamadas. */
export function aiWillReply(...contents: string[]): void {
  state.aiReplies.push(...contents);
}

/* ------------------------- ciclo de vida del caso ------------------------- */

export async function resetHarness(): Promise<void> {
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW_MS });
  state.requests = [];
  state.sse = [];
  state.consoleErrors = 0;
  state.inflight = 0;
  state.seq = { out: 0, upload: 0 };
  state.overrides = [];
  state.aiReplies = [];
  g.__goldenAfter = [];
  vi.stubGlobal("fetch", fakeFetch);
  vi.spyOn(console, "error").mockImplementation(() => {
    state.consoleErrors += 1;
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});

  const sql = getSql();
  await resetDatabase(sql);
  await seedOrganizations(sql);
  // La siembra no es parte del comportamiento registrado.
  state.requests = [];
  for (const org of [ORG_A, ORG_B]) {
    state.unsubscribe.push(
      subscribe(org, (event) => {
        state.sse.push({ org, type: event.type, data: event.data });
      })
    );
  }
}

export async function teardownHarness(): Promise<void> {
  await settle().catch(() => {});
  for (const off of state.unsubscribe.splice(0)) off();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
}

/** Ejecuta lo encolado con `after()` (como Next al terminar la respuesta). */
export async function drainAfter(): Promise<void> {
  const queue = g.__goldenAfter ?? [];
  while (queue.length > 0) {
    const task = queue.shift()!;
    await (typeof task === "function" ? task() : task);
  }
}

/**
 * Espera a que termine el trabajo en segundo plano de la app: tareas
 * `after()`, descargas de adjuntos (`ensureAssetAvailable`), turnos del
 * agente (coalesce) y peticiones en vuelo.
 */
export async function settle(): Promise<void> {
  const sql = getSql();
  let idle = 0;
  for (let i = 0; i < 600; i++) {
    await sleep(5);
    await drainAfter();
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from media_asset
      where fetch_status = 'pending' and wa_media_id is not null
    `;
    const busy =
      state.inflight > 0 ||
      (g.__goldenAfter?.length ?? 0) > 0 ||
      (g.__agentCoalesce?.size ?? 0) > 0 ||
      (row?.n ?? 0) > 0;
    idle = busy ? 0 : idle + 1;
    if (idle >= 3) return;
  }
  throw new Error("golden: la app no terminó su trabajo en segundo plano (settle)");
}

/* ------------------------------- webhook ------------------------------- */

export function sign(raw: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;
}

type HttpResult = { status: number; body: unknown };

async function describeResponse(res: Response): Promise<HttpResult> {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // texto plano (p. ej. el challenge del GET)
  }
  return { status: res.status, body };
}

export async function postWebhook(
  payload: unknown,
  opts: { token?: string; signature?: "auto" | "none" | string; raw?: string } = {}
): Promise<HttpResult> {
  const token = opts.token ?? process.env.META_WEBHOOK_VERIFY_TOKEN!;
  const raw = opts.raw ?? JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = process.env.META_APP_SECRET;
  const signature = opts.signature ?? "auto";
  if (signature === "auto") {
    if (secret) headers["x-hub-signature-256"] = sign(raw, secret);
  } else if (signature !== "none") {
    headers["x-hub-signature-256"] = signature;
  }
  const req = new Request(`http://localhost:3000/api/webhooks/wa/${token}`, {
    method: "POST",
    headers,
    body: raw,
  });
  const res = await webhookPost(req, { params: Promise.resolve({ webhookToken: token }) });
  const out = await describeResponse(res);
  await drainAfter();
  await settle();
  return out;
}

export async function getWebhook(
  query: Record<string, string>,
  opts: { token?: string } = {}
): Promise<HttpResult> {
  const token = opts.token ?? process.env.META_WEBHOOK_VERIFY_TOKEN!;
  const qs = new URLSearchParams(query).toString();
  const req = new Request(`http://localhost:3000/api/webhooks/wa/${token}?${qs}`);
  const res = await webhookGet(req, { params: Promise.resolve({ webhookToken: token }) });
  return describeResponse(res);
}

/** Resultado de una función de servicio: valor o error tipado (code/message). */
export async function outcome(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return { ok: await fn() };
  } catch (err) {
    if (err instanceof Error) {
      const e = err as Error & { code?: unknown; messageId?: unknown };
      return {
        error: {
          name: e.name,
          code: e.code ?? null,
          message: e.message,
          ...(e.messageId !== undefined ? { messageId: e.messageId } : {}),
        },
      };
    }
    return { error: String(err) };
  }
}

/* ------------------------------ instantánea ------------------------------ */

const ts = (col: string) => `(extract(epoch from ${col}) * 1000)::float8 as ${col.split(".").pop()}`;

const TIME_COLUMNS = new Set([
  "archived_at",
  "created_at",
  "updated_at",
  "handoff_at",
  "last_inbound_at",
  "last_message_at",
  "wa_timestamp",
  "last_activity_at",
  "occurred_at",
]);

function reviveTimes(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        TIME_COLUMNS.has(k) && typeof v === "number" ? new Date(Math.round(v)) : v,
      ])
    )
  );
}

/**
 * Columnas EXPLÍCITAS de hoy (no `select *`): las columnas que añada R1 son
 * aditivas y no cambian la instantánea. Si R3 quita una columna, se adapta
 * esta proyección (no los archivos __golden__) para seguir dando la misma forma.
 */
async function snapshotDb(): Promise<Record<string, unknown>> {
  const sql = getSql();
  const q = async (text: string) =>
    reviveTimes((await sql.unsafe(text)) as unknown as Record<string, unknown>[]);

  const contact = await q(`
    select organization_id, id, wa_identity, phone, wa_user_id, name, notes, ficha, source,
      ${ts("archived_at")}, ${ts("created_at")}, ${ts("updated_at")}
    from contact order by organization_id, wa_identity`);
  const conversation = await q(`
    select cv.organization_id, cv.id, cv.contact_id, cv.is_test, cv.ai_enabled,
      ${ts("cv.handoff_at")}, cv.handoff_reason, ${ts("cv.last_inbound_at")},
      ${ts("cv.last_message_at")}, cv.unread_count, ${ts("cv.created_at")}, ${ts("cv.updated_at")}
    from conversation cv join contact c on c.id = cv.contact_id
    order by cv.organization_id, c.wa_identity, cv.is_test`);
  const message = await q(`
    select organization_id, id, conversation_id, wa_message_id, direction, type, text, status,
      error, ai_generated, origin, media_asset_id, ${ts("wa_timestamp")}, ${ts("created_at")}
    from message
    order by organization_id, created_at, wa_message_id nulls last, direction, text, id`);
  const mediaAsset = await q(`
    select organization_id, id, kind, wa_media_id, mime_type, file_name, file_size, caption,
      payload, storage_path, fetch_status, fetch_error, ${ts("created_at")}, ${ts("updated_at")}
    from media_asset order by organization_id, created_at, wa_media_id nulls last, kind`);
  const lead = await q(`
    select l.organization_id, l.id, l.contact_id, l.stage_id, l.position,
      ${ts("l.last_activity_at")}, ${ts("l.created_at")}, ${ts("l.updated_at")}
    from lead l join contact c on c.id = l.contact_id
    order by l.organization_id, c.wa_identity`);
  const leadStageEvent = await q(`
    select e.organization_id, e.lead_id, e.contact_id, e.from_stage_id, e.to_stage_id,
      e.to_stage_name, e.to_stage_kind, e.source, e.approximate, ${ts("e.occurred_at")}
    from lead_stage_event e join contact c on c.id = e.contact_id
    order by e.organization_id, c.wa_identity, e.occurred_at`);
  const template = await q(`
    select organization_id, id, name, language, category, body, status, rejection_reason,
      wa_template_id, ${ts("updated_at")}
    from template order by organization_id, name, language`);
  const addressBook = await q(`
    select organization_id, wa_identity, name, ${ts("created_at")}, ${ts("updated_at")}
    from wa_address_book_entry order by organization_id, wa_identity`);

  // Credenciales por la API pública (`getCredentialsByOrg`): en R2 pasa a ser
  // la vista de `channel_account` con los mismos campos. Sin `id` interno y
  // con el token reducido a su tipo.
  const labels = secrets();
  const credentials: Record<string, unknown> = {};
  for (const org of [ORG_A, ORG_B]) {
    const c = await getCredentialsByOrg(org);
    if (!c) {
      credentials[org] = null;
      continue;
    }
    const { id: _id, token, ...rest } = c;
    credentials[org] = { ...rest, token: labels[token] ?? "<unknown-token>" };
  }

  return {
    contact,
    conversation,
    message,
    media_asset: mediaAsset,
    lead,
    lead_stage_event: leadStageEvent,
    template,
    wa_address_book_entry: addressBook,
    credentials,
  };
}

/** Instantánea normalizada de todo lo observable del caso. */
export async function snapshot(extra: Record<string, unknown> = {}): Promise<unknown> {
  await settle();
  const db = await snapshotDb();
  const n = new Normalizer(secrets(), REAL_NOW_MS);
  const requests = state.requests.map((r) => ({ ...r, auth: n.bearer(r.auth) }));
  return JSON.parse(
    JSON.stringify(
      n.value({
        db,
        ...extra,
        requests,
        sse: state.sse,
        consoleErrors: state.consoleErrors,
      })
    )
  );
}

/** ID de la conversación real de un contacto (por su identidad de hoy). */
export async function conversationIdOf(organizationId: string, waIdentity: string): Promise<string> {
  const rows = await getSql()<{ id: string }[]>`
    select cv.id from conversation cv join contact c on c.id = cv.contact_id
    where cv.organization_id = ${organizationId} and c.wa_identity = ${waIdentity}
      and cv.is_test = false
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error(`golden: sin conversación para ${waIdentity} en ${organizationId}`);
  return id;
}

/** Peticiones registradas hasta ahora (para aserciones de apoyo, no golden). */
export function recordedRequests(): readonly RecordedRequest[] {
  return state.requests;
}

/* ---------------------------- archivos golden ---------------------------- */

type Store = { file: string; data: Record<string, unknown>; dirty: boolean };
const stores = new Map<string, Store>();

function storeFor(testPath: string): Store {
  const base = path.basename(testPath).replace(/\.golden\.test\.ts$/, "");
  const file = path.join(path.dirname(testPath), "__golden__", `${base}.json`);
  let store = stores.get(file);
  if (!store) {
    const data = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)
      : {};
    store = { file, data, dirty: false };
    stores.set(file, store);
  }
  return store;
}

/**
 * Compara con el golden registrado. Con `GOLDEN_UPDATE=1` lo (re)escribe:
 * solo se hace sobre el código SIN cambios (T005) o con una nota en el
 * registro y la aprobación del orquestador (ADR §3.7). Un caso sin golden
 * registrado FALLA: jamás se crea en silencio.
 */
export function expectGolden(value: unknown): void {
  const { testPath, currentTestName } = expect.getState();
  if (!testPath || !currentTestName) throw new Error("golden: fuera de un test");
  const store = storeFor(testPath);
  if (process.env.GOLDEN_UPDATE === "1") {
    store.data[currentTestName] = value;
    store.dirty = true;
    return;
  }
  if (!(currentTestName in store.data)) {
    throw new Error(
      `falta el golden «${currentTestName}» en ${path.relative(process.cwd(), store.file)}: ` +
        "se registra SOLO sobre el código sin cambios (GOLDEN_UPDATE=1)"
    );
  }
  expect(value).toEqual(store.data[currentTestName]);
}

export function writeGoldenStores(): void {
  for (const store of stores.values()) {
    if (!store.dirty) continue;
    mkdirSync(path.dirname(store.file), { recursive: true });
    writeFileSync(store.file, `${JSON.stringify(store.data, null, 2)}\n`);
    store.dirty = false;
  }
}
