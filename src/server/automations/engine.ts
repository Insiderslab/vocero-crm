import { and, eq, isNull, isNotNull, max } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { countVariables } from "@/lib/templates";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { isWindowOpen } from "@/server/inbox/window";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { sendTemplate } from "@/server/whatsapp/templates";

/**
 * Motor de automatizaciones (custom heili.cloud).
 *
 * Regla: a los contactos con el tag T, cada N días, enviar la plantilla
 * aprobada P. El envío real lo hace `sendTemplate` — el mismo camino del
 * composer— así que respeta credenciales cifradas, sandbox y errores tipados.
 *
 * Decisiones de cumplimiento (Meta):
 * - Solo plantillas aprobadas; fuera de la ventana de 24 h no hay texto libre.
 * - Si la ventana está ABIERTA se salta: gastar una plantilla pudiendo
 *   escribir gratis es tirar dinero y reputación.
 * - Cadencia cableada por contacto (último `sent` de ESA regla) y tope por
 *   tick: no es un broadcast, es re-engagement medido.
 */

export type AutomationStats = {
  orgs: number;
  rules: number;
  sent: number;
  failed: number;
  skippedWindow: number;
  skippedCooldown: number;
};

const MAX_SENDS_PER_RULE_TICK = 50;
const SLEEP_BETWEEN_SENDS_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function recordRun(input: {
  organizationId: string;
  ruleId: string;
  contactId: string;
  status: "sent" | "failed";
  detail?: string | null;
}) {
  const db = getDb();
  await db.insert(schema.automationRun).values({
    id: newId("automationRun"),
    organizationId: input.organizationId,
    ruleId: input.ruleId,
    contactId: input.contactId,
    status: input.status,
    detail: input.detail ?? null,
  });
}

/** Corre las reglas habilitadas de UNA organización. */
export async function runAutomationsForOrg(
  organizationId: string
): Promise<AutomationStats> {
  const stats: AutomationStats = {
    orgs: 1,
    rules: 0,
    sent: 0,
    failed: 0,
    skippedWindow: 0,
    skippedCooldown: 0,
  };
  const db = getDb();

  // Sin WhatsApp conectado (o pidiendo reconexión) no hay nada que hacer:
  // se salta la org entera sin llenar la bitácora de fallos espurios.
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds || creds.status === "reconnect_required") return stats;

  const rules = await db
    .select()
    .from(schema.automationRule)
    .where(
      scoped(
        schema.automationRule.organizationId,
        organizationId,
        eq(schema.automationRule.enabled, true)
      )
    );

  for (const rule of rules) {
    stats.rules++;

    const templates = await db
      .select()
      .from(schema.template)
      .where(
        scoped(
          schema.template.organizationId,
          organizationId,
          eq(schema.template.id, rule.templateId)
        )
      )
      .limit(1);
    const template = templates[0];
    // Regla creada con plantilla válida que luego fue rechazada/borrada en
    // Meta: se apaga sola en la práctica, sin borrar la regla.
    if (!template || template.status !== "approved") continue;
    const variableCount = countVariables(template.body);
    if (variableCount > 1) continue; // v1: {{1}} = nombre, nada más

    // Contactos candidatos: con el tag, vivos y con teléfono.
    const tagged = await db
      .select({ contact: schema.contact })
      .from(schema.contactTag)
      .innerJoin(
        schema.contact,
        eq(schema.contactTag.contactId, schema.contact.id)
      )
      .where(
        scoped(
          schema.contactTag.organizationId,
          organizationId,
          eq(schema.contactTag.tagId, rule.tagId),
          isNull(schema.contact.archivedAt),
          isNotNull(schema.contact.phone)
        )
      );
    if (tagged.length === 0) continue;

    // Último envío exitoso por contacto de ESTA regla (la cadencia).
    const lastRuns = await db
      .select({
        contactId: schema.automationRun.contactId,
        last: max(schema.automationRun.createdAt),
      })
      .from(schema.automationRun)
      .where(
        and(
          eq(schema.automationRun.ruleId, rule.id),
          eq(schema.automationRun.status, "sent")
        )
      )
      .groupBy(schema.automationRun.contactId);
    const lastByContact = new Map(
      lastRuns.map((r) => [r.contactId, r.last])
    );
    const cutoff = new Date(Date.now() - rule.intervalDays * 86_400_000);

    let sentThisRule = 0;
    for (const { contact } of tagged) {
      if (sentThisRule >= MAX_SENDS_PER_RULE_TICK) break;

      const last = lastByContact.get(contact.id);
      if (last && last > cutoff) {
        stats.skippedCooldown++;
        continue;
      }

      const conversation = await getOrCreateConversation(
        organizationId,
        contact.id
      );
      if (isWindowOpen(conversation.lastInboundAt)) {
        stats.skippedWindow++;
        continue;
      }

      try {
        await sendTemplate({
          organizationId,
          conversationId: conversation.id,
          templateId: rule.templateId,
          variables: variableCount === 1 ? [contact.name] : [],
        });
        await recordRun({
          organizationId,
          ruleId: rule.id,
          contactId: contact.id,
          status: "sent",
        });
        stats.sent++;
        sentThisRule++;
      } catch (err) {
        await recordRun({
          organizationId,
          ruleId: rule.id,
          contactId: contact.id,
          status: "failed",
          detail: err instanceof Error ? err.message : "error desconocido",
        });
        stats.failed++;
      }
      await sleep(SLEEP_BETWEEN_SENDS_MS);
    }
  }
  return stats;
}

/** Corre las reglas de TODAS las organizaciones (tick del scheduler). */
export async function runAllAutomations(): Promise<AutomationStats> {
  const db = getDb();
  const orgs = await db
    .select({ id: schema.organization.id })
    .from(schema.organization);

  const total: AutomationStats = {
    orgs: 0,
    rules: 0,
    sent: 0,
    failed: 0,
    skippedWindow: 0,
    skippedCooldown: 0,
  };
  for (const org of orgs) {
    try {
      const stats = await runAutomationsForOrg(org.id);
      total.orgs += stats.orgs;
      total.rules += stats.rules;
      total.sent += stats.sent;
      total.failed += stats.failed;
      total.skippedWindow += stats.skippedWindow;
      total.skippedCooldown += stats.skippedCooldown;
    } catch (err) {
      // Una org rota no tumba el tick del resto.
      console.error(`[automations] falló la org ${org.id}:`, err);
    }
  }
  if (total.sent > 0 || total.failed > 0) {
    console.log(
      `[automations] tick: ${total.sent} enviados, ${total.failed} fallidos, ` +
        `${total.skippedWindow} con ventana abierta, ${total.skippedCooldown} en espera`
    );
  }
  return total;
}
