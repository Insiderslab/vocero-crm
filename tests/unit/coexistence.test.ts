import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accountUpdateEffect,
  HISTORY_DECLINED_CODE,
  parseHistoryValue,
  parseStateSyncValue,
} from "@/server/inbox/coexistence";
import type { WebhookValue } from "@/server/inbox/webhook";

/**
 * 009 — Coexistence: parsers puros de los webhooks `history`,
 * `smb_app_state_sync` y `account_update`. La integración con la BD se
 * ejercita en el self-test E2E (scripts/e2e-selftest.mjs, sección 009).
 */

const BUSINESS = "393470000000";
const CUSTOMER = "393331112222";

function historyValue(history: WebhookValue["history"]): WebhookValue {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: BUSINESS, phone_number_id: "111" },
    history,
  };
}

describe("parseHistoryValue (009)", () => {
  it("separa entrantes (from = hilo) y salientes (los escribió el negocio)", () => {
    const parsed = parseHistoryValue(
      historyValue([
        {
          metadata: { phase: 0, chunk_order: 1, progress: 40 },
          threads: [
            {
              id: CUSTOMER,
              messages: [
                {
                  from: CUSTOMER,
                  id: "wamid.h1",
                  timestamp: "1760000000",
                  type: "text",
                  text: { body: "Hola, ¿tienen cita?" },
                  history_context: { status: "READ" },
                },
                {
                  from: BUSINESS,
                  to: CUSTOMER,
                  id: "wamid.h2",
                  timestamp: "1760000100",
                  type: "text",
                  text: { body: "Sí, mañana a las 10" },
                  history_context: { status: "DELIVERED" },
                },
              ],
            },
          ],
        },
      ])
    );
    expect(parsed.declined).toBe(false);
    expect(parsed.progress).toBe(40);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0]).toMatchObject({
      identity: CUSTOMER,
      direction: "in",
      waMessageId: "wamid.h1",
      text: "Hola, ¿tienen cita?",
      status: "read",
    });
    expect(parsed.messages[1]).toMatchObject({
      identity: CUSTOMER,
      direction: "out",
      status: "delivered",
    });
    expect(parsed.messages[1]!.timestamp.toISOString()).toBe(
      new Date(1760000100 * 1000).toISOString()
    );
  });

  it("negocio que no compartió el historial → declined, sin mensajes", () => {
    const parsed = parseHistoryValue(
      historyValue([
        {
          errors: [
            {
              code: HISTORY_DECLINED_CODE,
              title: "History sync is turned off by the business",
            },
          ],
        },
      ])
    );
    expect(parsed.declined).toBe(true);
    expect(parsed.messages).toHaveLength(0);
  });

  it("omite reacciones, mensajes sin id o sin fecha, e hilos sin teléfono", () => {
    const parsed = parseHistoryValue(
      historyValue([
        {
          threads: [
            {
              id: CUSTOMER,
              messages: [
                { from: CUSTOMER, id: "wamid.r", timestamp: "1760000000", type: "reaction" },
                { from: CUSTOMER, id: "", timestamp: "1760000000", type: "text", text: { body: "x" } },
                { from: CUSTOMER, id: "wamid.nots", timestamp: "", type: "text", text: { body: "x" } },
              ],
            },
            { messages: [{ from: CUSTOMER, id: "wamid.noth", timestamp: "1760000000", type: "text" }] },
          ],
        },
      ])
    );
    expect(parsed.messages).toHaveLength(0);
  });

  it("adjuntos: se conserva el pie como texto (el binario no se importa)", () => {
    const parsed = parseHistoryValue(
      historyValue([
        {
          threads: [
            {
              id: CUSTOMER,
              messages: [
                {
                  from: CUSTOMER,
                  id: "wamid.img",
                  timestamp: "1760000000",
                  type: "image",
                  image: { id: "media1", caption: "la foto del local" },
                },
              ],
            },
          ],
        },
      ])
    );
    expect(parsed.messages[0]).toMatchObject({ type: "image", text: "la foto del local" });
  });

  it("normaliza México 521→52 en el hilo para que coincida con wa_identity", () => {
    const parsed = parseHistoryValue(
      historyValue([
        {
          threads: [
            {
              id: "5214621234567",
              messages: [
                { from: "5214621234567", id: "wamid.mx", timestamp: "1760000000", type: "text", text: { body: "hola" } },
              ],
            },
          ],
        },
      ])
    );
    expect(parsed.messages[0]).toMatchObject({ identity: "524621234567", direction: "in" });
  });

  it("payload vacío o sin history → nada, sin lanzar", () => {
    expect(parseHistoryValue({}).messages).toEqual([]);
  });
});

describe("parseStateSyncValue (009)", () => {
  it("contactos de la agenda: alta con nombre completo, baja por teléfono", () => {
    const entries = parseStateSyncValue({
      state_sync: [
        {
          type: "contact",
          contact: { full_name: "Giulia Rossi", first_name: "Giulia", phone_number: "+39 333 111 2222" },
          action: "add",
          metadata: { timestamp: "1760000000" },
        },
        { type: "contact", contact: { phone_number: "393334445555" }, action: "remove" },
      ],
    });
    expect(entries).toEqual([
      { action: "upsert", identity: CUSTOMER, name: "Giulia Rossi" },
      { action: "remove", identity: "393334445555" },
    ]);
  });

  it("sin nombre o sin teléfono, o de otro tipo → se omite", () => {
    expect(
      parseStateSyncValue({
        state_sync: [
          { type: "contact", contact: { phone_number: "393331112222" }, action: "add" },
          { type: "contact", contact: { full_name: "Sin número" }, action: "add" },
          { type: "label", action: "add" },
        ],
      })
    ).toEqual([]);
  });

  it("usa first_name si falta full_name", () => {
    expect(
      parseStateSyncValue({
        state_sync: [
          { type: "contact", contact: { first_name: "Marco", phone_number: "393339990000" }, action: "add" },
        ],
      })
    ).toEqual([{ action: "upsert", identity: "393339990000", name: "Marco" }]);
  });
});

describe("accountUpdateEffect (009)", () => {
  it("PARTNER_REMOVED y ACCOUNT_OFFBOARDED cortan; ACCOUNT_RECONNECTED restablece", () => {
    expect(accountUpdateEffect("PARTNER_REMOVED")).toBe("disconnected");
    expect(accountUpdateEffect("ACCOUNT_OFFBOARDED")).toBe("disconnected");
    expect(accountUpdateEffect("ACCOUNT_RECONNECTED")).toBe("reconnected");
  });

  it("otros eventos de account_update se ignoran", () => {
    expect(accountUpdateEffect("VERIFIED_ACCOUNT")).toBeNull();
    expect(accountUpdateEffect(undefined)).toBeNull();
  });
});

describe("getEmbeddedSignupConfig (009)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function freshConfig() {
    vi.resetModules();
    const mod = await import("@/server/whatsapp/embedded-signup");
    return mod.getEmbeddedSignupConfig();
  }

  function baseEnv() {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://x:x@localhost:5432/x");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-token-test");
  }

  it("sin App ID / Config ID / App Secret → desactivado (el botón no aparece)", async () => {
    baseEnv();
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("META_ES_CONFIG_ID", "");
    vi.stubEnv("META_APP_SECRET", "abc");
    expect(await freshConfig()).toEqual({ enabled: false });
  });

  it("con las tres → activado, y jamás expone el App Secret", async () => {
    baseEnv();
    vi.stubEnv("META_APP_ID", "609974691965875");
    vi.stubEnv("META_ES_CONFIG_ID", "998877");
    vi.stubEnv("META_APP_SECRET", "s3cr3t-never-public");
    const cfg = await freshConfig();
    expect(cfg).toMatchObject({ enabled: true, appId: "609974691965875", configId: "998877" });
    expect(JSON.stringify(cfg)).not.toContain("s3cr3t");
  });
});
