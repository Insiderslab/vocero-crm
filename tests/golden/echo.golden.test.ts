import { describe, it } from "vitest";
import { getSql } from "@/lib/db";
import { waFixture } from "./fixtures/whatsapp";
import { expectGolden, postWebhook, snapshot } from "./harness";

/**
 * Golden — ECO de coexistence (`smb_message_echoes`, 008; spec US1
 * escenario 5): el dueño contesta desde la app del teléfono → saliente
 * `manual`, no abre la ventana de 24 h, no dispara al agente y pausa la IA
 * (`manual_reply`) una sola vez.
 */
describe("echo", () => {
  it("texto a un lead que ya escribió → saliente manual, IA en pausa manual_reply", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    const response = await postWebhook(waFixture("echo-text"));
    expectGolden(await snapshot({ response }));
  });

  it("texto a un número nuevo → crea contacto y conversación sin ventana ni lead", async () => {
    const response = await postWebhook(waFixture("echo-text"));
    expectGolden(await snapshot({ response }));
  });

  it("imagen → adjunto descargado de Graph", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    const response = await postWebhook(waFixture("echo-image"));
    expectGolden(await snapshot({ response }));
  });

  it("duplicado → sin segundo mensaje ni segundo SSE", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    await postWebhook(waFixture("echo-text"));
    const response = await postWebhook(waFixture("echo-text"));
    expectGolden(await snapshot({ response }));
  });

  it("sin `to` → descartado", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    const response = await postWebhook(waFixture("echo-no-to"));
    expectGolden(await snapshot({ response }));
  });

  it("variante con la clave `messages` → se acepta igual", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    const response = await postWebhook(waFixture("echo-messages-key"));
    expectGolden(await snapshot({ response }));
  });

  it("con un handoff previo → no pisa el motivo ni la fecha del handoff", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    await getSql()`
      update conversation set handoff_at = now(), handoff_reason = 'cliente'
      where organization_id = 'org_golden_a'
    `;
    const response = await postWebhook(waFixture("echo-text"));
    expectGolden(await snapshot({ response }));
  });
});
