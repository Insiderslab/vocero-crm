import { beforeEach, describe, it } from "vitest";
import { sendText } from "@/server/inbox/send";
import { waFixture } from "./fixtures/whatsapp";
import { conversationIdOf, expectGolden, postWebhook, snapshot } from "./harness";
import { ORG_A } from "./setup";

/**
 * Golden — ESTADOS de los salientes (plan §7.1; spec US1 escenario 4, US2
 * escenario 2). Cada caso parte de un entrante de A y un texto enviado por A
 * (Graph le da `wamid.golden.out.1`).
 */
describe("status", () => {
  beforeEach(async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    await sendText({
      conversationId: await conversationIdOf(ORG_A, "525512345678"),
      organizationId: ORG_A,
      text: "Hola Ana, ¿en qué te ayudo?",
    });
  });

  it("sent → delivered → read en orden", async () => {
    const response = await postWebhook(waFixture("status-sent-delivered-read"));
    expectGolden(await snapshot({ response }));
  });

  it("delivered tardío después de read → se queda en read (monotonía)", async () => {
    await postWebhook(waFixture("status-sent-delivered-read"));
    const response = await postWebhook(waFixture("status-delivered-late"));
    expectGolden(await snapshot({ response }));
  });

  it("failed con código de Meta → error traducido en el mensaje y en el SSE", async () => {
    const response = await postWebhook(waFixture("status-failed"));
    expectGolden(await snapshot({ response }));
  });

  it("wamid de A que llega por el número de B → el mensaje de A no cambia", async () => {
    const response = await postWebhook(waFixture("status-a-wamid-on-b"));
    expectGolden(await snapshot({ response }));
  });

  it("estados y mensajes en el mismo change → primero los estados, luego los mensajes", async () => {
    const response = await postWebhook(waFixture("status-and-message"));
    expectGolden(await snapshot({ response }));
  });
});
