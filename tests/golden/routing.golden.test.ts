import { beforeEach, describe, it } from "vitest";
import { getSql } from "@/lib/db";
import { waFixture } from "./fixtures/whatsapp";
import { expectGolden, postWebhook, snapshot } from "./harness";

/**
 * Golden — ENRUTAMIENTO por organización (plan §7.1; spec US2 escenario 1).
 * El webhook es uno solo para toda la instancia: cada evento se resuelve por
 * su phone_number_id (mensajes) o su WABA (plantillas, account_update).
 */
describe("routing", () => {
  beforeEach(async () => {
    // La misma plantilla en A y en B: un evento de una WABA solo toca la suya.
    const sql = getSql();
    await sql`
      insert into template (id, organization_id, name, language, category, body, status)
      values ('tpl_golden_promo_a', 'org_golden_a', 'promo_golden', 'es_MX', 'MARKETING',
              'Hola {{1}}, tenemos una promoción', 'pending'),
             ('tpl_golden_promo_b', 'org_golden_b', 'promo_golden', 'es_MX', 'MARKETING',
              'Hola {{1}}, tenemos una promoción', 'pending')
    `;
  });

  it("estado de plantilla por WABA → solo la plantilla de esa organización", async () => {
    const approved = await postWebhook(waFixture("template-status-approved"));
    const rejected = await postWebhook(waFixture("template-status-rejected-b"));
    expectGolden(await snapshot({ responses: [approved, rejected] }));
  });

  it("phone_number_id desconocido → 200 y ninguna escritura", async () => {
    const response = await postWebhook(waFixture("unknown-phone-number-id"));
    expectGolden(await snapshot({ response }));
  });

  it("payload para el número de B → A no cambia", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    const response = await postWebhook(waFixture("inbound-text-b"));
    expectGolden(await snapshot({ response }));
  });

  it("field desconocido → ignorado sin error", async () => {
    const response = await postWebhook(waFixture("unknown-field"));
    expectGolden(await snapshot({ response }));
  });
});
