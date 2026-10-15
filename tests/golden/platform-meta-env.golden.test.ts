import { describe, expect, it, vi } from "vitest";
import { getSql } from "@/lib/db";
import { recordedRequests } from "./harness";
import { ORG_A, ORGS } from "./setup";

/**
 * 013 — Precedencia: con META_APP_ID / META_ES_CONFIG_ID en el entorno, el
 * entorno GANA sobre lo guardado en /admin (y la tarjeta lo dice). Archivo
 * aparte porque `getEnv()` se memoriza por proceso de prueba.
 */

const ENV_APP_ID = "111111111111";
const ENV_CONFIG_ID = "222222222222";

vi.hoisted(() => {
  process.env.SUPERADMIN_EMAILS = "root@golden.test";
  process.env.META_APP_ID = "111111111111";
  process.env.META_ES_CONFIG_ID = "222222222222";
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
import { GET as esGet, POST as esPost } from "@/app/api/settings/whatsapp/embedded-signup/route";

const sql = () => getSql();
const ROOT = { id: "usr_golden_root", email: "root@golden.test" };

async function seedRoot() {
  await sql()`insert into "user" (id, name, email) values (${ROOT.id}, 'root', ${ROOT.email})`;
  await sql()`insert into member (id, organization_id, user_id, role) values ('mem_root', ${ORG_A}, ${ROOT.id}, 'owner')`;
  auth.session = { user: ROOT, session: { activeOrganizationId: ORG_A } };
}

describe("013 — el entorno gana sobre /admin", () => {
  it("la tarjeta muestra la fuente «env» y el valor guardado (ignorado)", async () => {
    await seedRoot();
    const res = await platformPut(
      new Request("http://localhost/api/admin/platform/meta", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId: "999999999999", configId: "888888888888" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await (await platformGet()).json();
    expect(body.appId).toEqual({ value: ENV_APP_ID, source: "env", stored: "999999999999" });
    expect(body.configId).toEqual({ value: ENV_CONFIG_ID, source: "env", stored: "888888888888" });
  });

  it("el Embedded Signup usa los ID del entorno, no los guardados", async () => {
    await seedRoot();
    await sql()`
      insert into instance_setting (key, value) values ('meta_app_id', '999999999999'), ('meta_es_config_id', '888888888888')
    `;
    expect(await (await esGet()).json()).toMatchObject({ enabled: true, appId: ENV_APP_ID, configId: ENV_CONFIG_ID });

    // El canje lleva el App ID del entorno (Meta responde 404 en el doble: 422, da igual aquí).
    const res = await esPost(
      new Request("http://localhost/api/settings/whatsapp/embedded-signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "golden-env", wabaId: ORGS.A.wabaId, coexistence: true }),
      })
    );
    expect(res.status).toBe(422);
    const exchange = recordedRequests().find((r) => r.path.includes("/oauth/access_token"));
    expect(new URLSearchParams(exchange!.path.split("?")[1]).get("client_id")).toBe(ENV_APP_ID);
  });
});
