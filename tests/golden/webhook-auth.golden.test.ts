import { describe, it, vi } from "vitest";
import { waFixture } from "./fixtures/whatsapp";
import { expectGolden, getWebhook, postWebhook, sign, snapshot } from "./harness";

// Este archivo corre CON firma (META_APP_SECRET sintético). Va antes de los
// imports de la app: getEnv() memoriza el primer valor.
vi.hoisted(() => {
  process.env.META_APP_SECRET = "golden-synthetic-app-secret-0001";
});

/**
 * Golden — AUTENTICACIÓN del webhook (plan §7.1; spec US1 escenario 6):
 * capa 1 = segmento secreto de la URL (404), capa 2 = firma x-hub-signature-256
 * (401), body ilegible = 200 sin efectos, GET de verificación 200/403/404.
 */
describe("webhook-auth", () => {
  it("POST con token de URL equivocado → 404 sin efectos", async () => {
    const response = await postWebhook(waFixture("inbound-text-mx"), { token: "token-falso" });
    expectGolden(await snapshot({ response }));
  });

  it("POST con firma equivocada → 401 sin efectos", async () => {
    const response = await postWebhook(waFixture("inbound-text-mx"), {
      signature: sign("otro cuerpo", process.env.META_APP_SECRET!),
    });
    expectGolden(await snapshot({ response }));
  });

  it("POST sin firma con secreto configurado → 401 sin efectos", async () => {
    const response = await postWebhook(waFixture("inbound-text-mx"), { signature: "none" });
    expectGolden(await snapshot({ response }));
  });

  it("POST con firma de otro secreto → 401 sin efectos", async () => {
    const raw = JSON.stringify(waFixture("inbound-text-mx"));
    const response = await postWebhook(null, { raw, signature: sign(raw, "otro-secreto") });
    expectGolden(await snapshot({ response }));
  });

  it("POST con firma válida → 200 y mensaje ingerido", async () => {
    const response = await postWebhook(waFixture("inbound-text-mx"));
    expectGolden(await snapshot({ response }));
  });

  it("POST con body ilegible y firma válida → 200 sin efectos", async () => {
    const response = await postWebhook(null, { raw: "{esto no es json" });
    expectGolden(await snapshot({ response }));
  });

  it("GET de verificación correcto → 200 con el challenge", async () => {
    const response = await getWebhook({
      "hub.mode": "subscribe",
      "hub.verify_token": process.env.META_WEBHOOK_VERIFY_TOKEN!,
      "hub.challenge": "golden-challenge-123",
    });
    expectGolden(await snapshot({ response }));
  });

  it("GET con verify_token equivocado → 403", async () => {
    const response = await getWebhook({
      "hub.mode": "subscribe",
      "hub.verify_token": "otro-token",
      "hub.challenge": "golden-challenge-123",
    });
    expectGolden(await snapshot({ response }));
  });

  it("GET con hub.mode distinto de subscribe → 403", async () => {
    const response = await getWebhook({
      "hub.mode": "unsubscribe",
      "hub.verify_token": process.env.META_WEBHOOK_VERIFY_TOKEN!,
      "hub.challenge": "golden-challenge-123",
    });
    expectGolden(await snapshot({ response }));
  });

  it("GET con token de URL equivocado → 404", async () => {
    const response = await getWebhook(
      {
        "hub.mode": "subscribe",
        "hub.verify_token": process.env.META_WEBHOOK_VERIFY_TOKEN!,
        "hub.challenge": "golden-challenge-123",
      },
      { token: "token-falso" }
    );
    expectGolden(await snapshot({ response }));
  });
});
