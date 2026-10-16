import { describe, expect, it, vi } from "vitest";
import { getSql } from "@/lib/db";
import { clearWebhookRouteCache, inboundStats } from "@/server/whatsapp/webhook-route";
import { waFixture } from "./fixtures/whatsapp";
import { graphFails, postWebhook, recordedRequests } from "./harness";
import { ORG_A, ORG_B, ORGS } from "./setup";

/**
 * 014 — Guardia del webhook (specs/custom-heili/014-guardia-webhook.md).
 * Aserciones EXPLÍCITAS, sin instantánea. PostgreSQL real y rutas verdaderas;
 * solo la sesión es un doble. Graph lo simula el harness (`graphFails` fija la
 * respuesta de Meta para el caso).
 *
 * - GET /api/settings/whatsapp/route-check: owner/admin; dice adónde manda
 *   Meta los eventos (solo el host ajeno), el silencio y si se puede restaurar;
 * - POST /api/admin/platform/meta/webhook: SOLO super-admin; vuelve a poner
 *   el CRM como callback de la app con el token de la app;
 * - las estadísticas de entrantes son por organización (A no ve las de B);
 * - ninguna respuesta lleva secretos.
 */

const APP_ID = "609974691965875";

vi.hoisted(() => {
  process.env.SUPERADMIN_EMAILS = "root@golden.test";
  process.env.META_APP_ID = "609974691965875";
  process.env.META_ES_CONFIG_ID = "998877665544";
});

const auth = vi.hoisted(() => ({
  session: null as null | {
    user: { id: string; email: string };
    session: { activeOrganizationId: string | null };
  },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getAuth: () => ({ api: { getSession: async () => auth.session } }) };
});

import { GET as routeCheckGet } from "@/app/api/settings/whatsapp/route-check/route";
import { POST as restorePost } from "@/app/api/admin/platform/meta/webhook/route";

const sql = () => getSql();

const USERS = {
  member: { id: "usr_golden_member", email: "member@golden.test", role: "member" },
  admin: { id: "usr_golden_admin", email: "admin@golden.test", role: "admin" },
  root: { id: "usr_golden_root", email: "root@golden.test", role: "owner" },
} as const;

async function seedUsers() {
  for (const u of Object.values(USERS)) {
    await sql()`insert into "user" (id, name, email) values (${u.id}, ${u.id}, ${u.email})`;
    await sql()`
      insert into member (id, organization_id, user_id, role)
      values (${`mem_${u.id}`}, ${ORG_A}, ${u.id}, ${u.role})
    `;
  }
}

function as(who: keyof typeof USERS | null) {
  auth.session = who
    ? { user: { id: USERS[who].id, email: USERS[who].email }, session: { activeOrganizationId: ORG_A } }
    : null;
}

const N8N = "https://insiderslab.app.n8n.cloud/webhook/942f3c9d-2c77-47d2-9031-5b232f4430d3/webhook";
const expected = () =>
  `${process.env.APP_BASE_URL}/api/webhooks/wa/${process.env.META_WEBHOOK_VERIFY_TOKEN}`;

function metaSays(application: string) {
  graphFails({
    method: "GET",
    path: new RegExp(`/${ORGS.A.phoneNumberId}\\?fields=webhook_configuration`),
    status: 200,
    json: { webhook_configuration: { application }, id: ORGS.A.phoneNumberId },
  });
}

const check = () => routeCheckGet(new Request("http://localhost/api/settings/whatsapp/route-check"));

function expectNoSecret(raw: string) {
  for (const s of [
    process.env.META_APP_SECRET!,
    process.env.META_WEBHOOK_VERIFY_TOKEN!,
    ORGS.A.token,
    ORGS.B.token,
    "942f3c9d",
  ]) {
    expect(raw).not.toContain(s);
  }
}

describe("014 — GET /api/settings/whatsapp/route-check", () => {
  it("member → 403 y nada se pregunta a Meta", async () => {
    await seedUsers();
    clearWebhookRouteCache();
    as("member");
    const res = await check();
    expect(res.status).toBe(403);
    expect(recordedRequests().filter((r) => r.to === "graph")).toEqual([]);
  });

  it("admin, callback en n8n: «elsewhere», solo el host, sin restaurar (no es super-admin)", async () => {
    await seedUsers();
    clearWebhookRouteCache();
    metaSays(N8N);
    as("admin");
    const res = await check();
    expect(res.status).toBe(200);
    const raw = await res.text();
    expectNoSecret(raw);
    const body = JSON.parse(raw);
    expect(body.route).toMatchObject({
      state: "elsewhere",
      level: "application",
      foreignHost: "insiderslab.app.n8n.cloud",
    });
    expect(body.canRestore).toBe(false);
    const graph = recordedRequests().filter((r) => r.to === "graph");
    expect(graph).toHaveLength(1);
    expect(graph[0]!.path).toContain(`/${ORGS.A.phoneNumberId}?fields=webhook_configuration`);
    expect(graph[0]!.auth).toBe(`Bearer ${ORGS.A.token}`);
  });

  it("callback = CRM → ok; super-admin → canRestore", async () => {
    await seedUsers();
    clearWebhookRouteCache();
    metaSays(expected());
    as("root");
    const body = await (await check()).json();
    expect(body.route.state).toBe("ok");
    expect(body.canRestore).toBe(true);
  });
});

describe("014 — POST /api/admin/platform/meta/webhook", () => {
  it.each(["member", "admin"] as const)("%s (no super-admin) → 403, ninguna llamada a Meta", async (who) => {
    await seedUsers();
    as(who);
    const res = await restorePost();
    expect(res.status).toBe(403);
    expect(recordedRequests().filter((r) => r.to === "graph")).toEqual([]);
  });

  it("super-admin: POST {app}/subscriptions con el token de la app; respuesta sin secretos", async () => {
    await seedUsers();
    as("root");
    graphFails({ method: "POST", path: new RegExp(`/${APP_ID}/subscriptions$`), status: 200, json: { success: true } });
    const res = await restorePost();
    const raw = await res.text();
    expect(res.status).toBe(200);
    expectNoSecret(raw);
    expect(JSON.parse(raw)).toEqual({ ok: true });
    const calls = recordedRequests().filter((r) => r.to === "graph" && r.method === "POST");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toMatch(new RegExp(`^/v[\\d.]+/${APP_ID}/subscriptions$`));
    expect(calls[0]!.auth).toBe(`Bearer ${APP_ID}|${process.env.META_APP_SECRET}`);
    const sent = JSON.stringify(calls[0]!.body);
    expect(sent).toContain("whatsapp_business_account");
    expect(sent).toContain("smb_message_echoes");
  });

  it("Meta rechaza → 502 con el motivo, sin secretos", async () => {
    await seedUsers();
    as("root");
    graphFails({
      method: "POST",
      path: new RegExp(`/${APP_ID}/subscriptions$`),
      status: 400,
      json: { error: { message: `(#2200) Callback verification failed: ${expected()}`, code: 2200 } },
    });
    const res = await restorePost();
    expect(res.status).toBe(502);
    const raw = await res.text();
    expectNoSecret(raw);
    expect(JSON.parse(raw).error.code).toBe("meta_rejected");
  });
});

/**
 * `message.created_at` lo pone PostgreSQL (`now()`, reloj real) y el arnés
 * congela el reloj de JS en 2030: se alinea la fila al reloj del test.
 */
async function alignCreatedAt() {
  const at = new Date(Date.now() - 3_600_000).toISOString();
  await sql()`update message set created_at = ${at}::timestamp`;
}

describe("014 — inboundStats: PostgreSQL real, por organización", () => {
  it("un entrante de A cuenta para A y no para B", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    await alignCreatedAt();
    const a = await inboundStats(ORG_A);
    const b = await inboundStats(ORG_B);
    expect(a.inbound14d).toBe(1);
    expect(a.lastInboundAt).not.toBeNull();
    expect(b).toEqual({ inbound14d: 0, lastInboundAt: null });
  });

  it("un entrante de hace 15 días ya no cuenta", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    const old = new Date(Date.now() - 15 * 86_400_000).toISOString();
    await sql()`update message set created_at = ${old}::timestamp`;
    expect((await inboundStats(ORG_A)).inbound14d).toBe(0);
  });

  it("las conversaciones de prueba (Laboratorio) no cuentan", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    await alignCreatedAt();
    expect((await inboundStats(ORG_A)).inbound14d).toBe(1);
    await sql()`update conversation set is_test = true where organization_id = ${ORG_A}`;
    expect((await inboundStats(ORG_A)).inbound14d).toBe(0);
  });
});
