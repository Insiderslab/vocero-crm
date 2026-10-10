import { describe, it } from "vitest";
import { getSql } from "@/lib/db";
import { sendMediaMessage, sendStructured, sendText } from "@/server/inbox/send";
import { sendTemplate } from "@/server/whatsapp/templates";
import { waFixture } from "./fixtures/whatsapp";
import {
  conversationIdOf,
  expectGolden,
  graphFails,
  outcome,
  postWebhook,
  snapshot,
} from "./harness";
import { ORG_A, ORG_B } from "./setup";

/**
 * Golden — ENVÍO (plan §7.1; spec US1 escenario 7, US2): la petición a Graph
 * (ruta, método, body, tipo de bearer) y el resultado o el SendError
 * (`code`, mensaje) son el contrato que M1.3 debe reproducir.
 */

const ANA = "525512345678";

async function anaConversation(): Promise<string> {
  await postWebhook(waFixture("inbound-text-mx"));
  return conversationIdOf(ORG_A, ANA);
}

async function seedLabConversation(): Promise<string> {
  const sql = getSql();
  await sql`
    insert into contact (id, organization_id, wa_identity, phone, name, archived_at)
    values ('ct_golden_lab_persona', ${ORG_A}, '5200000000001', '5200000000001', 'Persona del Laboratorio', now())
  `;
  await sql`
    insert into conversation (id, organization_id, contact_id, is_test, ai_enabled, last_inbound_at)
    values ('cv_golden_lab_a', ${ORG_A}, 'ct_golden_lab_persona', true, true, '2030-01-01 11:59:00')
  `;
  return "cv_golden_lab_a";
}

async function seedApprovedTemplate(): Promise<void> {
  await getSql()`
    insert into template (id, organization_id, name, language, category, body, status, wa_template_id)
    values ('tpl_golden_cita_a', ${ORG_A}, 'cita_golden', 'es_MX', 'UTILITY',
            'Hola {{1}}, tu cita es el {{2}}', 'approved', '7000000000010')
  `;
}

const JPEG = Buffer.from("golden-synthetic-jpeg-bytes");

describe("send", () => {
  it("texto → POST /messages y saliente pending con el wamid", async () => {
    const conversationId = await anaConversation();
    const result = await outcome(() =>
      sendText({ conversationId, organizationId: ORG_A, text: "Hola Ana" })
    );
    expectGolden(await snapshot({ result }));
  });

  it("adjunto (imagen con pie) → upload a /media y luego /messages", async () => {
    const conversationId = await anaConversation();
    const result = await outcome(() =>
      sendMediaMessage({
        conversationId,
        organizationId: ORG_A,
        file: { data: JPEG, mimeType: "image/jpeg", fileName: "foto.jpg" },
        caption: "nuestro local",
      })
    );
    expectGolden(await snapshot({ result }));
  });

  it("documento con nombre → filename en el body", async () => {
    const conversationId = await anaConversation();
    const result = await outcome(() =>
      sendMediaMessage({
        conversationId,
        organizationId: ORG_A,
        file: { data: Buffer.from("%PDF-golden"), mimeType: "application/pdf", fileName: "cotizacion.pdf" },
      })
    );
    expectGolden(await snapshot({ result }));
  });

  it("upload fallido (Graph 500) → mensaje failed conservado y SendError upload_failed", async () => {
    const conversationId = await anaConversation();
    graphFails({ method: "POST", path: /\/media$/, status: 500, json: { error: { message: "Internal", code: 1 } } });
    const result = await outcome(() =>
      sendMediaMessage({
        conversationId,
        organizationId: ORG_A,
        file: { data: JPEG, mimeType: "image/jpeg", fileName: "foto.jpg" },
      })
    );
    expectGolden(await snapshot({ result }));
  });

  it("ubicación", async () => {
    const conversationId = await anaConversation();
    const result = await outcome(() =>
      sendStructured({
        conversationId,
        organizationId: ORG_A,
        kind: "location",
        location: { latitude: 19.4326, longitude: -99.1332, name: "Oficina", address: "Av. Sintética 1" },
      })
    );
    expectGolden(await snapshot({ result }));
  });

  it("contactos", async () => {
    const conversationId = await anaConversation();
    const result = await outcome(() =>
      sendStructured({
        conversationId,
        organizationId: ORG_A,
        kind: "contacts",
        contacts: [{ name: "Carla Ejemplo", phone: "+525500000000" }],
      })
    );
    expectGolden(await snapshot({ result }));
  });

  it("plantilla aprobada con variables → componente body y texto renderizado", async () => {
    const conversationId = await anaConversation();
    await seedApprovedTemplate();
    const result = await outcome(() =>
      sendTemplate({
        organizationId: ORG_A,
        conversationId,
        templateId: "tpl_golden_cita_a",
        variables: ["Ana", "lunes 10:00"],
      })
    );
    expectGolden(await snapshot({ result }));
  });

  it("plantilla con una variable vacía → TemplateError invalid sin fetch", async () => {
    const conversationId = await anaConversation();
    await seedApprovedTemplate();
    const result = await outcome(() =>
      sendTemplate({
        organizationId: ORG_A,
        conversationId,
        templateId: "tpl_golden_cita_a",
        variables: ["Ana", "  "],
      })
    );
    expectGolden(await snapshot({ result }));
  });

  it("destinatario solo BSUID → `to` es el BSUID", async () => {
    await postWebhook(waFixture("inbound-bsuid-only"));
    const conversationId = await conversationIdOf(ORG_A, "bsuid:MX.1000000000000000001");
    const result = await outcome(() =>
      sendText({ conversationId, organizationId: ORG_A, text: "Hola Beto" })
    );
    expectGolden(await snapshot({ result }));
  });

  it("ventana de 24 h cerrada → window_closed sin fetch", async () => {
    await postWebhook(waFixture("inbound-old-text"));
    const conversationId = await conversationIdOf(ORG_A, ANA);
    const result = await outcome(() =>
      sendText({ conversationId, organizationId: ORG_A, text: "¿Sigues ahí?" })
    );
    expectGolden(await snapshot({ result }));
  });

  it("token vencido (190) → reconnect_required, credencial marcada, el siguiente envío no llama a Graph", async () => {
    const conversationId = await anaConversation();
    graphFails({
      method: "POST",
      path: /\/messages$/,
      status: 401,
      json: { error: { message: "Error validating access token", type: "OAuthException", code: 190 } },
    });
    const first = await outcome(() =>
      sendText({ conversationId, organizationId: ORG_A, text: "Hola" })
    );
    const second = await outcome(() =>
      sendText({ conversationId, organizationId: ORG_A, text: "Hola otra vez" })
    );
    expectGolden(await snapshot({ results: [first, second] }));
  });

  it("Meta 5xx → meta_unavailable sin mensaje persistido", async () => {
    const conversationId = await anaConversation();
    graphFails({
      method: "POST",
      path: /\/messages$/,
      status: 503,
      json: { error: { message: "Service temporarily unavailable", type: "OAuthException", code: 2 } },
    });
    const result = await outcome(() =>
      sendText({ conversationId, organizationId: ORG_A, text: "Hola" })
    );
    expectGolden(await snapshot({ result }));
  });

  it("error 4xx de Meta (no auth) → meta_error con el mensaje de Meta", async () => {
    const conversationId = await anaConversation();
    graphFails({
      method: "POST",
      path: /\/messages$/,
      status: 400,
      json: { error: { message: "(#131030) Recipient phone number not in allowed list", code: 131030 } },
    });
    const result = await outcome(() =>
      sendText({ conversationId, organizationId: ORG_A, text: "Hola" })
    );
    expectGolden(await snapshot({ result }));
  });

  it("organización A sobre una conversación de B → rechazado sin fetch", async () => {
    await postWebhook(waFixture("inbound-text-b"));
    const conversationB = await conversationIdOf(ORG_B, ANA);
    const text = await outcome(() =>
      sendText({ conversationId: conversationB, organizationId: ORG_A, text: "intruso" })
    );
    const structured = await outcome(() =>
      sendStructured({
        conversationId: conversationB,
        organizationId: ORG_A,
        kind: "location",
        location: { latitude: 1, longitude: 1 },
      })
    );
    await getSql()`
      insert into template (id, organization_id, name, language, category, body, status)
      values ('tpl_golden_a_only', ${ORG_A}, 'aviso_golden', 'es_MX', 'UTILITY', 'Aviso', 'approved')
    `;
    const template = await outcome(() =>
      sendTemplate({ organizationId: ORG_A, conversationId: conversationB, templateId: "tpl_golden_a_only" })
    );
    expectGolden(await snapshot({ results: { text, structured, template } }));
  });

  it("conversación del Laboratorio (is_test) → sandbox_violation sin fetch (texto, adjunto, plantilla)", async () => {
    const conversationId = await seedLabConversation();
    await seedApprovedTemplate();
    const text = await outcome(() =>
      sendText({ conversationId, organizationId: ORG_A, text: "jamás sale" })
    );
    const media = await outcome(() =>
      sendMediaMessage({
        conversationId,
        organizationId: ORG_A,
        file: { data: JPEG, mimeType: "image/jpeg" },
      })
    );
    const template = await outcome(() =>
      sendTemplate({
        organizationId: ORG_A,
        conversationId,
        templateId: "tpl_golden_cita_a",
        variables: ["Ana", "lunes"],
      })
    );
    expectGolden(await snapshot({ results: { text, media, template } }));
  });

  it("organización que nunca conectó un número → not_connected sin fetch", async () => {
    // Una tercera organización sin conexión (caso límite de la spec: seed demo,
    // mock). Se siembra entera aquí: no hay credencial que borrar.
    const sql = getSql();
    await sql`insert into organization (id, name, slug) values ('org_golden_c', 'Negocio Golden C', 'golden-c')`;
    await sql`
      insert into contact (id, organization_id, wa_identity, phone, name)
      values ('ct_golden_c_cliente', 'org_golden_c', '525512345678', '525512345678', 'Ana en C')
    `;
    await sql`
      insert into conversation (id, organization_id, contact_id, last_inbound_at)
      values ('cv_golden_c_cliente', 'org_golden_c', 'ct_golden_c_cliente', '2030-01-01 11:59:00')
    `;
    const result = await outcome(() =>
      sendText({ conversationId: "cv_golden_c_cliente", organizationId: "org_golden_c", text: "Hola" })
    );
    expectGolden(await snapshot({ result }));
  });

  it("adjunto demasiado grande o de tipo irreconocible → MediaValidationError antes de tocar disco o red", async () => {
    const conversationId = await anaConversation();
    const tooLarge = await outcome(() =>
      sendMediaMessage({
        conversationId,
        organizationId: ORG_A,
        file: { data: Buffer.alloc(6 * 1024 * 1024), mimeType: "image/jpeg" },
      })
    );
    const badType = await outcome(() =>
      sendMediaMessage({
        conversationId,
        organizationId: ORG_A,
        file: { data: JPEG, mimeType: "no es un mime" },
      })
    );
    expectGolden(await snapshot({ results: { tooLarge, badType } }));
  });
});
