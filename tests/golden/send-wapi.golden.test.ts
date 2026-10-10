import { describe, it, vi } from "vitest";
import { sendMediaMessage, sendText } from "@/server/inbox/send";
import { revokeWapiKey, saveWapiKey } from "@/server/whatsapp/wapi-credentials";
import { waFixture } from "./fixtures/whatsapp";
import { conversationIdOf, expectGolden, outcome, postWebhook, snapshot } from "./harness";
import { ORG_A, ORG_B, WAPI_KEY_A } from "./setup";

// Gateway Wapi activo (C3): la instancia tiene WAPI_BASE_URL. Va antes de los
// imports de la app: getEnv() memoriza el primer valor.
vi.hoisted(() => {
  process.env.WAPI_BASE_URL = "https://wapi.golden.test";
});

/**
 * Golden — TRANSPORTE por organización (C3, plan §7.1 «trasporto Wapi per
 * organizzazione»): con clave Wapi propia, A va al gateway con SU clave; B,
 * sin clave, va directo a Meta con su token. En archivo aparte porque
 * WAPI_BASE_URL cambia la configuración de toda la instancia.
 */
describe("send-wapi", () => {
  it("A con clave propia → Wapi con la clave de A; B sin clave → Meta directo con el token de B", async () => {
    await saveWapiKey({ organizationId: ORG_A, key: WAPI_KEY_A, createdBy: "golden" });
    await postWebhook(waFixture("inbound-text-mx"));
    await postWebhook(waFixture("inbound-text-b"));
    const a = await outcome(async () =>
      sendText({
        conversationId: await conversationIdOf(ORG_A, "525512345678"),
        organizationId: ORG_A,
        text: "Hola desde A",
      })
    );
    const b = await outcome(async () =>
      sendText({
        conversationId: await conversationIdOf(ORG_B, "525512345678"),
        organizationId: ORG_B,
        text: "Hola desde B",
      })
    );
    expectGolden(await snapshot({ results: { a, b } }));
  });

  it("adjunto entrante y saliente de A por Wapi → la clave solo viaja al gateway", async () => {
    await saveWapiKey({ organizationId: ORG_A, key: WAPI_KEY_A, createdBy: "golden" });
    await postWebhook(waFixture("inbound-image"));
    const result = await outcome(async () =>
      sendMediaMessage({
        conversationId: await conversationIdOf(ORG_A, "525512345678"),
        organizationId: ORG_A,
        file: { data: Buffer.from("golden-synthetic-jpeg-bytes"), mimeType: "image/jpeg", fileName: "foto.jpg" },
      })
    );
    expectGolden(await snapshot({ result }));
  });

  it("clave de A revocada → A vuelve a Meta directo con su token, nunca con otra clave", async () => {
    await saveWapiKey({ organizationId: ORG_A, key: WAPI_KEY_A, createdBy: "golden" });
    await revokeWapiKey(ORG_A);
    await postWebhook(waFixture("inbound-text-mx"));
    const result = await outcome(async () =>
      sendText({
        conversationId: await conversationIdOf(ORG_A, "525512345678"),
        organizationId: ORG_A,
        text: "Hola sin gateway",
      })
    );
    expectGolden(await snapshot({ result }));
  });
});
