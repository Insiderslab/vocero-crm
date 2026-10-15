import { describe, expect, it, vi } from "vitest";
import { getDb, getSql } from "@/lib/db";
import { guideState, guideSteps, reconnectVia } from "@/lib/whatsapp-guide";
import { seedDemo } from "@/server/seed/demo";
import { markReconnectRequired, saveCredentials } from "@/server/whatsapp/credentials";
import { graphFails, recordedRequests } from "./harness";
import { ORG_A, ORGS } from "./setup";

/**
 * 013 — Piattaforma → Meta (specs/custom-heili/013-collegamento-whatsapp-guidato.md).
 * Aserciones EXPLÍCITAS, sin instantánea: los golden existentes no se tocan.
 * PostgreSQL real, rutas verdaderas; solo la sesión es un doble (Better Auth
 * leería una cookie): `auth.session` decide quién llama.
 *
 * - /api/admin/platform/meta: SOLO super-admin (member, admin y owner que no
 *   lo son → 403, y nada se escribe);
 * - lo guardado ahí lo usa el Embedded Signup (config pública y canje del code);
 * - ninguna respuesta contiene un secreto (App Secret, token, verify token).
 */

vi.hoisted(() => {
  process.env.SUPERADMIN_EMAILS = "root@golden.test";
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

import { GET as platformGet, PUT as platformPut } from "@/app/api/admin/platform/meta/route";
import {
  GET as esGet,
  POST as esPost,
} from "@/app/api/settings/whatsapp/embedded-signup/route";
import { GET as statusGet } from "@/app/api/settings/whatsapp/status/route";

const sql = () => getSql();

/** Cuenta WhatsApp (channel_account) de la organización: la escribe saveCredentials. */
async function accountOf(org: string): Promise<string> {
  const [row] = await sql()<{ id: string }[]>`
    select id from channel_account where organization_id = ${org} and channel = 'whatsapp'`;
  return row!.id;
}
const APP_ID = "609974691965875";
const CONFIG_ID = "998877665544";

/** Usuarios sintéticos de A: uno por rol + el super-admin (owner de A también). */
const USERS = {
  member: { id: "usr_golden_member", email: "member@golden.test", role: "member" },
  admin: { id: "usr_golden_admin", email: "admin@golden.test", role: "admin" },
  owner: { id: "usr_golden_owner", email: "owner@golden.test", role: "owner" },
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

const put = (body: unknown) =>
  platformPut(
    new Request("http://localhost/api/admin/platform/meta", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

async function storedRows() {
  return sql()<{ key: string; value: string; updated_by: string | null }[]>`
    select key, value, updated_by from instance_setting order by key
  `;
}

/** Lo que jamás puede salir en una respuesta. */
function secretsOf(): string[] {
  return [
    process.env.META_APP_SECRET!,
    process.env.META_WEBHOOK_VERIFY_TOKEN!,
    ORGS.A.token,
    ORGS.B.token,
  ];
}

function expectNoSecret(raw: string) {
  for (const s of secretsOf()) expect(raw).not.toContain(s);
}

describe("013 — /api/admin/platform/meta: solo super-admin", () => {
  it.each(["member", "admin", "owner"] as const)(
    "%s de la organización (no super-admin) → 403 en GET y PUT, nada escrito",
    async (who) => {
      await seedUsers();
      as(who);
      const g = await platformGet();
      expect(g.status).toBe(403);
      expect((await g.json()).error.code).toBe("not_superadmin");
      const p = await put({ appId: APP_ID, configId: CONFIG_ID });
      expect(p.status).toBe(403);
      expect(await storedRows()).toEqual([]);
    }
  );

  it("sin sesión → 401, nada escrito", async () => {
    as(null);
    expect((await platformGet()).status).toBe(401);
    expect((await put({ appId: APP_ID, configId: CONFIG_ID })).status).toBe(401);
    expect(await storedRows()).toEqual([]);
  });

  it("super-admin: guarda, la fuente pasa a «db» y queda quién lo guardó", async () => {
    await seedUsers();
    as("root");
    const before = await (await platformGet()).json();
    expect(before.appId).toEqual({ value: null, source: "none", stored: null });
    expect(before.embeddedSignupReady).toBe(false);

    const res = await put({ appId: ` ${APP_ID} `, configId: CONFIG_ID });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.appId).toEqual({ value: APP_ID, source: "db", stored: APP_ID });
    expect(body.configId).toEqual({ value: CONFIG_ID, source: "db", stored: CONFIG_ID });
    expect(body.appSecret.present).toBe(true);
    expect(body.embeddedSignupReady).toBe(true);
    expect(await storedRows()).toEqual([
      { key: "meta_app_id", value: APP_ID, updated_by: USERS.root.id },
      { key: "meta_es_config_id", value: CONFIG_ID, updated_by: USERS.root.id },
    ]);

    // Vacío / null borra.
    const cleared = await put({ appId: "", configId: null });
    expect(cleared.status).toBe(200);
    expect(await storedRows()).toEqual([]);
  });

  it("super-admin: ID inválidos o un appSecret en el cuerpo → 422 y nada escrito", async () => {
    await seedUsers();
    as("root");
    for (const body of [
      { appId: "12345", configId: CONFIG_ID },
      { appId: APP_ID, configId: "1".repeat(26) },
      { appId: "60997469196587x", configId: CONFIG_ID },
      { appId: APP_ID, configId: CONFIG_ID, appSecret: "intento" },
    ]) {
      expect((await put(body)).status).toBe(422);
    }
    expect(await storedRows()).toEqual([]);
  });

  it("la base de datos rechaza por sí sola una clave o un valor fuera de la lista (CHECK)", async () => {
    await expect(
      sql()`insert into instance_setting (key, value) values ('meta_app_secret', '123456')`
    ).rejects.toThrow(/instance_setting_key_ck/);
    await expect(
      sql()`insert into instance_setting (key, value) values ('meta_app_id', 'abc123456')`
    ).rejects.toThrow(/instance_setting_value_ck/);
  });
});

describe("013 — lo guardado en /admin lo usa el Embedded Signup", () => {
  async function esPostCode(code: string) {
    return esPost(
      new Request("http://localhost/api/settings/whatsapp/embedded-signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          wabaId: ORGS.A.wabaId,
          phoneNumberId: ORGS.A.phoneNumberId,
          coexistence: true,
        }),
      })
    );
  }

  it("sin configuración: el botón no aparece y el POST responde 409 sin llamar a Meta", async () => {
    await seedUsers();
    as("owner");
    expect(await (await esGet()).json()).toEqual({ enabled: false });
    const status = await (await statusGet()).json();
    expect(status.platform).toEqual({ ready: false, reason: "not_configured" });
    const res = await esPostCode("golden-code-1");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("not_configured");
    expect(recordedRequests()).toEqual([]);
  });

  it("con App ID y Config ID guardados: config pública con esos ID y canje con client_id = App ID", async () => {
    await seedUsers();
    as("root");
    expect((await put({ appId: APP_ID, configId: CONFIG_ID })).status).toBe(200);

    as("owner");
    const cfgRaw = await (await esGet()).text();
    expect(JSON.parse(cfgRaw)).toEqual({
      enabled: true,
      appId: APP_ID,
      configId: CONFIG_ID,
      graphVersion: "v25.0",
    });
    expectNoSecret(cfgRaw);
    expect((await (await statusGet()).json()).platform).toEqual({ ready: true, reason: null });

    // Canje completo contra la Graph simulada: token nuevo, número de la WABA,
    // suscripción y pedido de agenda + historial (coexistence).
    const NEW_TOKEN = "EAAGoldenSyntheticTokenFromEs0001";
    graphFails({ method: "GET", path: /\/oauth\/access_token\?/, status: 200, json: { access_token: NEW_TOKEN } });
    graphFails({
      method: "GET",
      path: new RegExp(`/${ORGS.A.wabaId}/phone_numbers\\?`),
      status: 200,
      json: { data: [{ id: ORGS.A.phoneNumberId }] },
    });
    graphFails({
      method: "GET",
      path: new RegExp(`/${ORGS.A.phoneNumberId}\\?fields=`),
      status: 200,
      json: { id: ORGS.A.phoneNumberId, display_phone_number: ORGS.A.displayPhoneNumber, verified_name: "Golden A" },
    });
    graphFails({ method: "POST", path: /\/subscribed_apps$/, status: 200, json: { success: true } });
    graphFails({ method: "POST", path: /\/smb_app_data$/, status: 200, json: { success: true }, times: 2 });

    const res = await esPostCode("golden-code-2");
    const raw = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(raw)).toMatchObject({ ok: true, onboardingMode: "coexistence" });
    expectNoSecret(raw);
    expect(raw).not.toContain(NEW_TOKEN);

    const exchange = recordedRequests().find((r) => r.path.includes("/oauth/access_token"));
    expect(exchange).toBeDefined();
    const qs = new URLSearchParams(exchange!.path.split("?")[1]);
    expect(qs.get("client_id")).toBe(APP_ID);
    expect(qs.get("code")).toBe("golden-code-2");

    const mode = await sql()<{ onboarding_mode: string }[]>`
      select onboarding_mode from meta_credentials where organization_id = ${ORG_A}
    `;
    expect(mode[0]?.onboarding_mode).toBe("coexistence");
  });
});

describe("013 — ninguna respuesta nueva lleva secretos", () => {
  it("estado de la plataforma (super-admin) y estado de la guía (owner): sin App Secret, token ni verify token", async () => {
    await seedUsers();
    as("root");
    await put({ appId: APP_ID, configId: CONFIG_ID });
    const platformRaw = await (await platformGet()).text();
    expectNoSecret(platformRaw);
    const platform = JSON.parse(platformRaw);
    // Del App Secret solo presencia y contadores de la firma (PR #9).
    expect(platform.appSecret.present).toBe(true);
    expect(Object.keys(platform.appSecret).sort()).toEqual(
      ["invalidSinceBoot", "lastInvalidAt", "lastVerifiedAt", "present"].sort()
    );

    as("owner");
    const statusRaw = await (await statusGet()).text();
    expectNoSecret(statusRaw);
    const status = JSON.parse(statusRaw);
    // Ni siquiera los últimos 4 del token (`tokenLast4`): la guía no los necesita.
    expect(Object.keys(status.connection).sort()).toEqual(
      ["appDisconnectedAt", "connectedAt", "displayPhoneNumber", "onboardingMode", "phoneNumberId", "status", "verifiedName"].sort()
    );
    expect(status.connection).toMatchObject({
      phoneNumberId: ORGS.A.phoneNumberId,
      displayPhoneNumber: ORGS.A.displayPhoneNumber,
      status: "connected",
      onboardingMode: "manual",
      appDisconnectedAt: null,
    });
    expect(status.signature.configured).toBe(true);
  });

  it("estado de la guía: último entrante real de la organización, sin el Laboratorio ni otra organización", async () => {
    await seedUsers();
    as("owner");
    expect((await (await statusGet()).json()).lastInboundAt).toBeNull();
    await sql()`
      insert into contact (id, organization_id, wa_identity, name)
      values ('ct_g_real', ${ORG_A}, '5215500000001', 'Real'),
             ('ct_g_lab', ${ORG_A}, '5215500000002', 'Lab'),
             ('ct_g_b', 'org_golden_b', '5215500000003', 'B')
    `;
    const accA = await accountOf(ORG_A);
    const accB = await accountOf("org_golden_b");
    await sql()`
      insert into conversation (id, organization_id, contact_id, is_test, last_inbound_at, channel_account_id)
      values ('cv_g_real', ${ORG_A}, 'ct_g_real', false, '2030-01-01T10:00:00'::timestamp, ${accA}),
             ('cv_g_lab', ${ORG_A}, 'ct_g_lab', true, '2030-06-01T10:00:00'::timestamp, null),
             ('cv_g_b', 'org_golden_b', 'ct_g_b', false, '2031-01-01T10:00:00'::timestamp, ${accB})
    `;
    expect((await (await statusGet()).json()).lastInboundAt).toBe("2030-01-01T10:00:00.000Z");
  });

  it("revisión PR #15: la demo NO cuenta (ni en la franja ni en el paso 3)", async () => {
    await seedUsers();
    as("owner");
    await seedDemo(getDb(), ORG_A);
    const [n] = await sql()<{ n: string }[]>`
      select count(*) as n from conversation where organization_id = ${ORG_A} and last_inbound_at is not null`;
    expect(Number(n!.n)).toBeGreaterThan(0); // la demo sí escribe last_inbound_at…
    const status = await (await statusGet()).json();
    expect(status.lastInboundAt).toBeNull(); // …pero no es un mensaje real
    const state = guideState({ platformReady: status.platform.ready, connection: status.connection });
    expect(guideSteps(state, status.lastInboundAt, status.connection.connectedAt).test).toBe("current");
  });

  it("revisión PR #15: un mensaje de antes de reconectar no completa el paso 3; uno de después sí", async () => {
    await seedUsers();
    as("owner");
    const acc = await accountOf(ORG_A);
    await sql()`insert into contact (id, organization_id, wa_identity, phone, name)
      values ('ct_g_old', ${ORG_A}, '5215500000009', '5215500000009', 'Cliente')`;
    await sql()`insert into conversation (id, organization_id, contact_id, is_test, last_inbound_at, channel_account_id)
      values ('cv_g_old', ${ORG_A}, 'ct_g_old', false, '2030-01-01T10:00:00'::timestamp, ${acc})`;
    // Conectado ANTES del mensaje: el paso 3 está hecho.
    await sql()`update meta_credentials set updated_at = '2030-01-01T09:00:00'::timestamp where organization_id = ${ORG_A}`;
    const step = async () => {
      const s = await (await statusGet()).json();
      return guideSteps(guideState({ platformReady: s.platform.ready, connection: s.connection }), s.lastInboundAt, s.connection.connectedAt).test;
    };
    expect(await step()).toBe("done");
    // Reconexión (función real, token nuevo) DESPUÉS del mensaje: ya no cuenta.
    const a = ORGS.A;
    await saveCredentials({
      organizationId: a.id, wabaId: a.wabaId, phoneNumberId: a.phoneNumberId, token: `${a.token}-nuevo`,
      displayPhoneNumber: a.displayPhoneNumber, verifiedName: a.verifiedName,
    });
    await sql()`update meta_credentials set updated_at = '2030-02-01T09:00:00'::timestamp where organization_id = ${ORG_A}`;
    expect(await step()).toBe("current");
    // Un mensaje nuevo después de reconectar → hecho otra vez.
    await sql()`update conversation set last_inbound_at = '2030-02-01T10:00:00'::timestamp where id = 'cv_g_old'`;
    expect(await step()).toBe("done");
  });

  it("member: 403 en el estado de la guía (owner/admin, como el resto de WhatsApp)", async () => {
    await seedUsers();
    as("member");
    expect((await statusGet()).status).toBe(403);
  });
});

describe("013 (Q3) — un número conectado a mano jamás se reconecta con Meta", () => {
  async function guideVia() {
    as("owner");
    const status = await (await statusGet()).json();
    return { status, via: reconnectVia({ platformReady: status.platform.ready, connection: status.connection }) };
  }

  it("manual + token caducado, con la plataforma lista → solo token nuevo (sin botón de Meta)", async () => {
    await seedUsers();
    as("root");
    await put({ appId: APP_ID, configId: CONFIG_ID });
    await markReconnectRequired(ORG_A);
    const { status, via } = await guideVia();
    expect(status.platform.ready).toBe(true);
    expect(status.connection).toMatchObject({ status: "reconnect_required", onboardingMode: "manual" });
    expect(via).toBe("manual");
  });

  it("coexistence + token caducado, con la plataforma lista → «Ricollega con Meta»", async () => {
    await seedUsers();
    as("root");
    await put({ appId: APP_ID, configId: CONFIG_ID });
    const a = ORGS.A;
    await saveCredentials({
      organizationId: a.id,
      wabaId: a.wabaId,
      phoneNumberId: a.phoneNumberId,
      token: a.token,
      displayPhoneNumber: a.displayPhoneNumber,
      verifiedName: a.verifiedName,
      onboardingMode: "coexistence",
    });
    await markReconnectRequired(ORG_A);
    const { status, via } = await guideVia();
    expect(status.connection).toMatchObject({ status: "reconnect_required", onboardingMode: "coexistence" });
    expect(via).toBe("meta");
  });
});
