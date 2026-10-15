import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  META_ID_PATTERN,
  metaIdInput,
  metaPlatformInput,
  resolveMetaIds,
} from "@/server/platform/meta-config";

/**
 * 013 — Configurazione Meta della piattaforma (/admin → Piattaforma → Meta):
 * risoluzione ambiente-o-DB (l'ambiente vince), validazione degli ID, uso da
 * parte dell'Embedded Signup e nessun segreto nelle risposte. Il DB è un
 * doppio (`instance-settings`); la versione con PostgreSQL vero è
 * tests/golden/platform-meta.golden.test.ts.
 */

const store = vi.hoisted(() => ({
  values: {} as Record<string, string>,
  reads: 0,
  writes: [] as Record<string, string | null>[],
}));

vi.mock("@/server/platform/instance-settings", () => ({
  readInstanceSettings: async () => {
    store.reads += 1;
    return { ...store.values };
  },
  writeInstanceSettings: async (values: Record<string, string | null>) => {
    store.writes.push(values);
    for (const [k, v] of Object.entries(values)) {
      if (v === null) delete store.values[k];
      else store.values[k] = v;
    }
  },
}));

const SECRET = "s3cr3t-app-secret-never-public";

function baseEnv() {
  vi.stubEnv("APP_BASE_URL", "https://crm.heili.cloud");
  vi.stubEnv("DATABASE_URL", "postgresql://x:x@localhost:5432/x");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-token-test");
  vi.stubEnv("META_APP_ID", "");
  vi.stubEnv("META_ES_CONFIG_ID", "");
  vi.stubEnv("META_APP_SECRET", SECRET);
  vi.stubEnv("WAPI_BASE_URL", "");
}

beforeEach(() => {
  store.values = {};
  store.reads = 0;
  store.writes = [];
  vi.resetModules();
  baseEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/* ------------------------- risoluzione (pura) ------------------------- */

describe("resolveMetaIds: l'ambiente vince, poi il DB", () => {
  it("ambiente impostato → ambiente, anche se il DB ha un altro valore", () => {
    expect(
      resolveMetaIds(
        { META_APP_ID: "111111", META_ES_CONFIG_ID: "222222" },
        { meta_app_id: "999999", meta_es_config_id: "888888" }
      )
    ).toEqual({
      appId: { value: "111111", source: "env" },
      configId: { value: "222222", source: "env" },
    });
  });

  it("senza ambiente → DB", () => {
    expect(resolveMetaIds({}, { meta_app_id: "999999", meta_es_config_id: "888888" })).toEqual({
      appId: { value: "999999", source: "db" },
      configId: { value: "888888", source: "db" },
    });
  });

  it("misto: ogni ID per conto suo", () => {
    const r = resolveMetaIds({ META_APP_ID: "111111" }, { meta_es_config_id: "888888" });
    expect(r.appId).toEqual({ value: "111111", source: "env" });
    expect(r.configId).toEqual({ value: "888888", source: "db" });
  });

  it("ambiente con soli spazi = assente", () => {
    expect(resolveMetaIds({ META_APP_ID: "   " }, { meta_app_id: "999999" }).appId).toEqual({
      value: "999999",
      source: "db",
    });
  });

  it("niente da nessuna parte → none", () => {
    expect(resolveMetaIds({}, {})).toEqual({
      appId: { value: null, source: "none" },
      configId: { value: null, source: "none" },
    });
  });
});

/* ------------------------------ validazione ------------------------------ */

describe("validazione degli ID: solo cifre, da 6 a 25", () => {
  it.each(["123456", "1".repeat(25), " 609974691965875 "])("%j valido", (v) => {
    const r = metaIdInput.safeParse(v);
    expect(r.success).toBe(true);
    expect(r.success && r.data).toBe(v.trim());
  });

  it.each(["12345", "1".repeat(26), "12a456", "-123456", "123 456", "1e10000", "１２３４５６"])(
    "%j non valido",
    (v) => {
      expect(metaIdInput.safeParse(v).success).toBe(false);
    }
  );

  it.each(["", "   ", null])("%j → null (cancella)", (v) => {
    const r = metaIdInput.safeParse(v);
    expect(r.success && r.data).toBeNull();
  });

  it("il pattern del server è quello della scheda", () => {
    expect(META_ID_PATTERN.source).toBe("^\\d{6,25}$");
  });

  it("il corpo accetta SOLO appId e configId (un appSecret → errore)", () => {
    expect(metaPlatformInput.safeParse({ appId: "123456", configId: null }).success).toBe(true);
    expect(
      metaPlatformInput.safeParse({ appId: "123456", configId: "654321", appSecret: SECRET }).success
    ).toBe(false);
    expect(metaPlatformInput.safeParse({ appId: "123456" }).success).toBe(false);
  });
});

/* ---------------------- uso da parte dell'Embedded Signup ---------------------- */

async function esConfig() {
  const mod = await import("@/server/whatsapp/embedded-signup");
  return mod.getEmbeddedSignupConfig();
}

describe("getEmbeddedSignupConfig legge ambiente-o-DB", () => {
  it("solo DB → attivo con gli ID del DB, senza App Secret", async () => {
    store.values = { meta_app_id: "609974691965875", meta_es_config_id: "998877" };
    const cfg = await esConfig();
    expect(cfg).toEqual({
      enabled: true,
      appId: "609974691965875",
      configId: "998877",
      graphVersion: "v25.0",
    });
    expect(JSON.stringify(cfg)).not.toContain(SECRET);
  });

  it("ambiente e DB diversi → vince l'ambiente", async () => {
    vi.stubEnv("META_APP_ID", "111111");
    vi.stubEnv("META_ES_CONFIG_ID", "222222");
    store.values = { meta_app_id: "999999", meta_es_config_id: "888888" };
    expect(await esConfig()).toMatchObject({ enabled: true, appId: "111111", configId: "222222" });
  });

  it("entrambi nell'ambiente → il DB non si legge nemmeno", async () => {
    vi.stubEnv("META_APP_ID", "111111");
    vi.stubEnv("META_ES_CONFIG_ID", "222222");
    await esConfig();
    expect(store.reads).toBe(0);
  });

  it("manca un ID → spento", async () => {
    store.values = { meta_app_id: "609974691965875" };
    expect(await esConfig()).toEqual({ enabled: false });
  });

  it("senza META_APP_SECRET → spento (il segreto resta solo d'ambiente)", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    store.values = { meta_app_id: "609974691965875", meta_es_config_id: "998877" };
    expect(await esConfig()).toEqual({ enabled: false });
  });

  it("con il gateway Wapi → spento", async () => {
    vi.stubEnv("WAPI_BASE_URL", "https://wapi.example.test");
    store.values = { meta_app_id: "609974691965875", meta_es_config_id: "998877" };
    expect(await esConfig()).toEqual({ enabled: false });
  });
});

/* --------------------------- stato per la scheda --------------------------- */

describe("getMetaPlatformStatus: fonte visibile, segreto mai", () => {
  async function status() {
    const mod = await import("@/server/platform/meta-config");
    return mod.getMetaPlatformStatus();
  }

  it("dice la fonte di ogni ID e il valore salvato anche quando l'ambiente vince", async () => {
    vi.stubEnv("META_APP_ID", "111111");
    store.values = { meta_app_id: "999999", meta_es_config_id: "888888" };
    const s = await status();
    expect(s.appId).toEqual({ value: "111111", source: "env", stored: "999999" });
    expect(s.configId).toEqual({ value: "888888", source: "db", stored: "888888" });
    expect(s.embeddedSignupReady).toBe(true);
    expect(s.checklist.domain).toBe("crm.heili.cloud");
    expect(s.checklist.featureType).toBe("whatsapp_business_app_onboarding");
    expect(s.checklist.webhookFields).toHaveLength(6);
  });

  it("dell'App Secret solo presenza e contatori, mai il valore", async () => {
    const s = await status();
    expect(s.appSecret.present).toBe(true);
    expect(JSON.stringify(s)).not.toContain(SECRET);
    expect(Object.keys(s.appSecret).sort()).toEqual(
      ["invalidSinceBoot", "lastInvalidAt", "lastVerifiedAt", "present"].sort()
    );
  });

  it("senza segreto: present=false e non pronto", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    store.values = { meta_app_id: "609974691965875", meta_es_config_id: "998877" };
    const s = await status();
    expect(s.appSecret.present).toBe(false);
    expect(s.embeddedSignupReady).toBe(false);
  });
});

/* ------------------------- rotta: solo super-admin ------------------------- */

const auth = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string }; session: { activeOrganizationId: string | null } },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: async () => auth.session } }),
}));

describe("/api/admin/platform/meta: solo super-admin", () => {
  beforeEach(() => {
    vi.stubEnv("SUPERADMIN_EMAILS", "root@heili.test");
    auth.session = null;
  });

  async function call(method: "GET" | "PUT", body?: unknown) {
    const mod = await import("@/app/api/admin/platform/meta/route");
    const req = new Request("http://localhost/api/admin/platform/meta", {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return method === "GET" ? mod.GET() : mod.PUT(req);
  }

  const as = (email: string) => {
    auth.session = { user: { id: "u_1", email }, session: { activeOrganizationId: "org_a" } };
  };

  it("senza sessione → 401", async () => {
    expect((await call("GET")).status).toBe(401);
  });

  it("utente non super-admin (anche se owner di un'azienda) → 403, niente letto né scritto", async () => {
    as("owner@azienda.test");
    const get = await call("GET");
    expect(get.status).toBe(403);
    expect((await get.json()).error.code).toBe("not_superadmin");
    const put = await call("PUT", { appId: "123456", configId: "654321" });
    expect(put.status).toBe(403);
    expect(store.reads).toBe(0);
    expect(store.writes).toEqual([]);
  });

  it("super-admin: salva, rilegge e non restituisce mai il segreto", async () => {
    as("root@heili.test");
    const put = await call("PUT", { appId: " 609974691965875 ", configId: "998877" });
    expect(put.status).toBe(200);
    const raw = await put.text();
    expect(raw).not.toContain(SECRET);
    expect(JSON.parse(raw).appId).toEqual({ value: "609974691965875", source: "db", stored: "609974691965875" });
    expect(store.writes).toEqual([{ meta_app_id: "609974691965875", meta_es_config_id: "998877" }]);
  });

  it("super-admin: ID non valido → 422 senza scrivere", async () => {
    as("root@heili.test");
    const put = await call("PUT", { appId: "12345", configId: "abc" });
    expect(put.status).toBe(422);
    expect(store.writes).toEqual([]);
  });

  it("super-admin: un campo appSecret nel corpo → 422 senza scrivere", async () => {
    as("root@heili.test");
    const put = await call("PUT", { appId: "123456", configId: "654321", appSecret: "x" });
    expect(put.status).toBe(422);
    expect(store.writes).toEqual([]);
  });

  it("super-admin: vuoto cancella", async () => {
    as("root@heili.test");
    store.values = { meta_app_id: "123456", meta_es_config_id: "654321" };
    const put = await call("PUT", { appId: "", configId: null });
    expect(put.status).toBe(200);
    expect(store.values).toEqual({});
  });
});
