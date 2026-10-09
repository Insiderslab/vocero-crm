import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWapiStore, wapiStore } from "./helpers/fake-wapi-db";

/**
 * C3 — clave Wapi por organización. Dos organizaciones con datos: el código
 * REAL de `wapi-credentials.ts` corre contra un doble que aplica el WHERE
 * renderizado (ver helpers/fake-wapi-db.ts).
 */

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const { createFakeWapiDb } = await import("./helpers/fake-wapi-db");
  const db = createFakeWapiDb();
  return { ...actual, getDb: () => db };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

const KEY_A = "hlp_live_AAAAAAAAAAAAAAAAAAAA1111";
const KEY_B = "hlp_live_BBBBBBBBBBBBBBBBBBBB2222";

describe("formato de la clave", () => {
  it("exige prefijo hlp_live_, 16+ caracteres sin espacios y tope de longitud", async () => {
    const { isValidWapiKeyFormat } = await import("@/server/whatsapp/wapi-credentials");
    expect(isValidWapiKeyFormat(KEY_A)).toBe(true);
    expect(isValidWapiKeyFormat("hlp_live_corta")).toBe(false);
    expect(isValidWapiKeyFormat("EAAG-token-de-meta-0123456789")).toBe(false);
    expect(isValidWapiKeyFormat("hlp_test_AAAAAAAAAAAAAAAAAAAA")).toBe(false);
    expect(isValidWapiKeyFormat(`hlp_live_${"A".repeat(10)} ${"B".repeat(10)}`)).toBe(false);
    expect(isValidWapiKeyFormat(`hlp_live_${"A".repeat(300)}`)).toBe(false);
    expect(isValidWapiKeyFormat(`${KEY_A}\nX-Evil: 1`)).toBe(false);
  });
});

describe("wapi_credentials por organización", () => {
  beforeEach(() => resetWapiStore());

  it("guarda CIFRADO: la fila no contiene el texto plano, y se descifra con la ENCRYPTION_KEY", async () => {
    const { saveWapiKey, getWapiKeyByOrg } = await import("@/server/whatsapp/wapi-credentials");
    const { last4 } = await saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u_1" });
    expect(last4).toBe("1111");
    const row = wapiStore().rows[0]!;
    expect(JSON.stringify(row)).not.toContain(KEY_A);
    expect(JSON.stringify(row)).not.toContain(KEY_A.slice(9)); // ni el cuerpo de la clave
    expect(row.keyCipher && row.keyIv && row.keyTag).toBeTruthy();
    expect(await getWapiKeyByOrg("org_a")).toBe(KEY_A);
  });

  it("negativo: org A no lee la clave de B ni al revés", async () => {
    const { saveWapiKey, getWapiKeyByOrg, getWapiKeyStatus } = await import(
      "@/server/whatsapp/wapi-credentials"
    );
    await saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u_a" });
    await saveWapiKey({ organizationId: "org_b", key: KEY_B, createdBy: "u_b" });
    expect(await getWapiKeyByOrg("org_a")).toBe(KEY_A);
    expect(await getWapiKeyByOrg("org_b")).toBe(KEY_B);
    expect(await getWapiKeyByOrg("org_c")).toBeNull(); // una tercera sin clave: nada
    expect(await getWapiKeyStatus("org_a")).toMatchObject({ configured: true, last4: "1111" });
    expect(await getWapiKeyStatus("org_b")).toMatchObject({ configured: true, last4: "2222" });
    expect(await getWapiKeyStatus("org_c")).toEqual({ configured: false });
  });

  it("el estado no contiene la clave ni el material cifrado", async () => {
    const { saveWapiKey, getWapiKeyStatus } = await import("@/server/whatsapp/wapi-credentials");
    await saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u_a" });
    const status = JSON.stringify(await getWapiKeyStatus("org_a"));
    expect(status).not.toContain(KEY_A);
    expect(status).not.toContain(wapiStore().rows[0]!.keyCipher);
  });

  it("revocar A deja a B intacta; revocar es idempotente y A queda sin clave", async () => {
    const { saveWapiKey, revokeWapiKey, getWapiKeyByOrg } = await import(
      "@/server/whatsapp/wapi-credentials"
    );
    await saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u_a" });
    await saveWapiKey({ organizationId: "org_b", key: KEY_B, createdBy: "u_b" });
    expect(await revokeWapiKey("org_a")).toBe(true);
    expect(await getWapiKeyByOrg("org_a")).toBeNull();
    expect(await getWapiKeyByOrg("org_b")).toBe(KEY_B);
    expect(await revokeWapiKey("org_a")).toBe(false); // ya revocada
    expect(await revokeWapiKey("org_c")).toBe(false); // sin fila
    expect(wapiStore().rows.find((r) => r.organizationId === "org_b")!.revokedAt).toBeNull();
  });

  it("volver a guardar tras revocar la reactiva (una fila por org)", async () => {
    const { saveWapiKey, revokeWapiKey, getWapiKeyByOrg } = await import(
      "@/server/whatsapp/wapi-credentials"
    );
    await saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u_a" });
    await revokeWapiKey("org_a");
    await saveWapiKey({ organizationId: "org_a", key: KEY_B, createdBy: "u_a" });
    expect(wapiStore().rows).toHaveLength(1);
    expect(await getWapiKeyByOrg("org_a")).toBe(KEY_B);
  });

  it("saveWapiKey rechaza org vacía y claves con formato inválido sin escribir", async () => {
    const { saveWapiKey } = await import("@/server/whatsapp/wapi-credentials");
    await expect(saveWapiKey({ organizationId: "", key: KEY_A, createdBy: "u" })).rejects.toThrow();
    await expect(
      saveWapiKey({ organizationId: "org_a", key: "EAAG-meta-token-0123456789", createdBy: "u" })
    ).rejects.toThrow();
    expect(wapiStore().writes).toBe(0);
  });

  it("una fila manipulada (tag alterado) lanza al descifrar: nunca devuelve una clave", async () => {
    const { saveWapiKey, getWapiKeyByOrg } = await import("@/server/whatsapp/wapi-credentials");
    await saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u_a" });
    wapiStore().rows[0]!.keyTag = Buffer.alloc(16, 1).toString("base64");
    await expect(getWapiKeyByOrg("org_a")).rejects.toThrow();
  });
});
