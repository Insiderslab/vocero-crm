import { describe, it } from "vitest";
import { getSql } from "@/lib/db";
import { waFixture } from "./fixtures/whatsapp";
import { expectGolden, postWebhook, snapshot } from "./harness";

/**
 * Golden — mensajes ENTRANTES (plan §7.1; spec US1 escenarios 1–3, US2).
 * Sin META_APP_SECRET: hoy la firma es opcional (D3), como en una instancia
 * sin secreto configurado.
 */
describe("inbound", () => {
  it("texto con teléfono mexicano 521 → identidad 52, conversación, lead, SSE", async () => {
    const response = await postWebhook(waFixture("inbound-text-mx"));
    expectGolden(await snapshot({ response }));
  });

  it("solo BSUID → contacto bsuid:<id> sin teléfono", async () => {
    const response = await postWebhook(waFixture("inbound-bsuid-only"));
    expectGolden(await snapshot({ response }));
  });

  it("teléfono + BSUID con contacto BSUID previo → mismo contacto (reconciliación)", async () => {
    const first = await postWebhook(waFixture("inbound-bsuid-only"));
    const second = await postWebhook(waFixture("inbound-phone-and-bsuid"));
    expectGolden(await snapshot({ responses: [first, second] }));
  });

  it("duplicado en el mismo payload y reentrega → un mensaje por wamid", async () => {
    const first = await postWebhook(waFixture("inbound-duplicate"));
    const again = await postWebhook(waFixture("inbound-duplicate"));
    expectGolden(await snapshot({ responses: [first, again] }));
  });

  it("imagen → media_asset descargado de Graph", async () => {
    const response = await postWebhook(waFixture("inbound-image"));
    expectGolden(await snapshot({ response }));
  });

  it("documento con nombre de archivo", async () => {
    const response = await postWebhook(waFixture("inbound-document"));
    expectGolden(await snapshot({ response }));
  });

  it("ubicación", async () => {
    const response = await postWebhook(waFixture("inbound-location"));
    expectGolden(await snapshot({ response }));
  });

  it("contactos compartidos", async () => {
    const response = await postWebhook(waFixture("inbound-contacts"));
    expectGolden(await snapshot({ response }));
  });

  it("adjunto roto (Graph 404) → mensaje conservado, asset failed", async () => {
    const response = await postWebhook(waFixture("inbound-broken-media"));
    expectGolden(await snapshot({ response }));
  });

  it("tipo no soportado (reacción, unsupported) → ignorado", async () => {
    const response = await postWebhook(waFixture("inbound-unsupported"));
    expectGolden(await snapshot({ response }));
  });

  it("sin identidad (ni from ni from_user_id) → descartado", async () => {
    const response = await postWebhook(waFixture("inbound-no-identity"));
    expectGolden(await snapshot({ response }));
  });

  it("varios entry y changes en el mismo payload (A y B) → cada uno en su organización", async () => {
    const response = await postWebhook(waFixture("inbound-multi"));
    expectGolden(await snapshot({ response }));
  });

  it("contacto archivado que vuelve a escribir → reactivado, se respeta el nombre del operador", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    await getSql()`
      update contact set archived_at = now(), name = 'Ana (editada)'
      where organization_id = 'org_golden_a'
    `;
    const response = await postWebhook(waFixture("inbound-text-mx-again"));
    expectGolden(await snapshot({ response }));
  });
});
