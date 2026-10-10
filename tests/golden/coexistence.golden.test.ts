import { describe, it } from "vitest";
import { getSql } from "@/lib/db";
import { saveCredentials } from "@/server/whatsapp/credentials";
import { waFixture } from "./fixtures/whatsapp";
import { expectGolden, postWebhook, snapshot } from "./harness";
import { ORGS } from "./setup";

/**
 * Golden — COEXISTENCE (009, PR #4): el número sigue en la app WhatsApp
 * Business del teléfono y además entra al CRM. Es comportamiento de WhatsApp
 * de HOY, así que M1.2/M1.3 lo deben reproducir igual:
 * - `history`: hilo importado sin efectos de mensaje nuevo (ni ventana, ni
 *   no-leídos, ni lead, ni IA), `created_at` = `wa_timestamp`, idempotente,
 *   solo en conexiones `coexistence`, sin reactivar archivados;
 * - `smb_app_state_sync`: agenda → nombres, sin crear contactos;
 * - `account_update`: corte/reconexión acotados a la WABA, al número y al modo.
 */

/** Reconecta A con el Embedded Signup en coexistence (función real). */
async function connectACoexistence(): Promise<void> {
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
}

describe("coexistence", () => {
  it("history: hilos importados en su lugar del tiempo, sin ventana, sin no-leídos, sin lead", async () => {
    await connectACoexistence();
    const response = await postWebhook(waFixture("history-two-threads"));
    expectGolden(await snapshot({ response }));
  });

  it("history después de un mensaje nuevo → no retrocede last_message_at ni toca la ventana", async () => {
    await connectACoexistence();
    await postWebhook(waFixture("inbound-text-mx"));
    const response = await postWebhook(waFixture("history-two-threads"));
    expectGolden(await snapshot({ response }));
  });

  it("history reenviado → idempotente por wamid", async () => {
    await connectACoexistence();
    await postWebhook(waFixture("history-two-threads"));
    const response = await postWebhook(waFixture("history-two-threads"));
    expectGolden(await snapshot({ response }));
  });

  it("history en una conexión manual → ignorado", async () => {
    const response = await postWebhook(waFixture("history-two-threads"));
    expectGolden(await snapshot({ response }));
  });

  it("history con un contacto archivado → no lo reactiva", async () => {
    await connectACoexistence();
    await postWebhook(waFixture("inbound-text-mx"));
    await getSql()`update contact set archived_at = now() where organization_id = 'org_golden_a'`;
    const response = await postWebhook(waFixture("history-two-threads"));
    expectGolden(await snapshot({ response }));
  });

  it("history rechazado por el negocio (2593109) → sin escrituras", async () => {
    await connectACoexistence();
    const response = await postWebhook(waFixture("history-declined"));
    expectGolden(await snapshot({ response }));
  });

  it("agenda: nombres para contactos de relleno, alta y baja, sin crear contactos", async () => {
    await connectACoexistence();
    // Ana existe con nombre de perfil; Caro existe con su teléfono como nombre (relleno).
    await postWebhook(waFixture("inbound-text-mx"));
    await getSql()`
      insert into contact (id, organization_id, wa_identity, phone, name)
      values ('ct_golden_caro', 'org_golden_a', '525511112222', '525511112222', '525511112222')
    `;
    const response = await postWebhook(waFixture("state-sync"));
    expectGolden(await snapshot({ response }));
  });

  it("agenda en una conexión manual → ignorada", async () => {
    const response = await postWebhook(waFixture("state-sync"));
    expectGolden(await snapshot({ response }));
  });

  it("contacto nuevo cuyo número está en la agenda → toma el nombre de la agenda", async () => {
    await connectACoexistence();
    await postWebhook(waFixture("state-sync"));
    const response = await postWebhook(waFixture("inbound-text-mx"));
    expectGolden(await snapshot({ response }));
  });

  it("account_update PARTNER_REMOVED con número → solo esa conexión coexistence de la WABA compartida", async () => {
    await connectACoexistence();
    // B comparte la WABA de A con otro número, también en coexistence.
    await saveCredentials({
      organizationId: ORGS.B.id,
      wabaId: ORGS.A.wabaId,
      phoneNumberId: ORGS.B.phoneNumberId,
      token: ORGS.B.token,
      displayPhoneNumber: ORGS.B.displayPhoneNumber,
      verifiedName: ORGS.B.verifiedName,
      onboardingMode: "coexistence",
    });
    const response = await postWebhook(waFixture("account-update-partner-removed-a"));
    expectGolden(await snapshot({ response }));
  });

  it("account_update ACCOUNT_OFFBOARDED sin número → toda la WABA en coexistence, nunca una conexión manual", async () => {
    await connectACoexistence();
    // B comparte la WABA de A pero se conectó a mano: no se marca.
    await saveCredentials({
      organizationId: ORGS.B.id,
      wabaId: ORGS.A.wabaId,
      phoneNumberId: ORGS.B.phoneNumberId,
      token: ORGS.B.token,
      displayPhoneNumber: ORGS.B.displayPhoneNumber,
      verifiedName: ORGS.B.verifiedName,
    });
    const response = await postWebhook(waFixture("account-update-offboarded-waba"));
    expectGolden(await snapshot({ response }));
  });

  it("account_update ACCOUNT_RECONNECTED → limpia el corte", async () => {
    await connectACoexistence();
    await postWebhook(waFixture("account-update-offboarded-waba"));
    const response = await postWebhook(waFixture("account-update-reconnected"));
    expectGolden(await snapshot({ response }));
  });

  it("account_update con otro evento → ignorado", async () => {
    await connectACoexistence();
    const response = await postWebhook(waFixture("account-update-other-event"));
    expectGolden(await snapshot({ response }));
  });

  it("reconectar el mismo número a mano conserva el modo coexistence y limpia el corte", async () => {
    await connectACoexistence();
    await postWebhook(waFixture("account-update-offboarded-waba"));
    const a = ORGS.A;
    await saveCredentials({
      organizationId: a.id,
      wabaId: a.wabaId,
      phoneNumberId: a.phoneNumberId,
      token: a.token,
      displayPhoneNumber: a.displayPhoneNumber,
      verifiedName: a.verifiedName,
    });
    expectGolden(await snapshot());
  });
});
