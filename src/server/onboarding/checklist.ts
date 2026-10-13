import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isOrgAdmin } from "@/lib/roles";

/**
 * 010 — estado de la checklist de primer avvio
 * (specs/custom-heili/010-sintesi-e-primo-avvio.md).
 *
 * Única fuente del cálculo: la usan la tarjeta «Primi passi» (Sintesi y
 * Automazioni), el aviso del botón «Crea regola» y el link de reapertura de
 * Impostazioni. Una sola consulta con cinco EXISTS, siempre atada a la
 * organización recibida vía `scoped(...)`.
 */

export type OnboardingStepKey =
  | "whatsapp"
  | "template"
  | "agent"
  | "lab"
  | "enabled";

export type OnboardingChecklist = {
  whatsappConnected: boolean;
  templateApproved: boolean;
  agentConfigured: boolean;
  labRunDone: boolean;
  agentEnabled: boolean;
  allDone: boolean;
};

/** Pasos en orden de presentación: de qué campo sale el estado y a dónde lleva. */
export const ONBOARDING_STEPS = [
  { key: "whatsapp", field: "whatsappConnected", href: "/settings/whatsapp" },
  { key: "template", field: "templateApproved", href: "/settings/templates" },
  { key: "agent", field: "agentConfigured", href: "/agent" },
  { key: "lab", field: "labRunDone", href: "/lab" },
  { key: "enabled", field: "agentEnabled", href: "/agent" },
] as const satisfies readonly {
  key: OnboardingStepKey;
  field: keyof Omit<OnboardingChecklist, "allDone">;
  href: string;
}[];

/**
 * ¿Se muestra la checklist? Solo a owner/admin, y solo mientras falte algún
 * paso — o siempre que venga de la reapertura de Impostazioni (`reopened`),
 * que es la única «memoria» y no toca la base de datos.
 */
export function showOnboardingChecklist(
  role: string,
  checklist: OnboardingChecklist,
  reopened: boolean
): boolean {
  return isOrgAdmin(role) && (reopened || !checklist.allDone);
}

export async function getOnboardingChecklist(
  organizationId: string
): Promise<OnboardingChecklist> {
  const db = getDb();
  const rows = await db.execute<{
    whatsapp_connected: boolean;
    template_approved: boolean;
    agent_configured: boolean;
    lab_run_done: boolean;
    agent_enabled: boolean;
  }>(sql`
    select
      exists(
        select 1 from meta_credentials
        where ${scoped(
          schema.metaCredentials.organizationId,
          organizationId,
          sql`meta_credentials.status = 'connected'`,
          sql`meta_credentials.app_disconnected_at is null`
        )}
      ) as whatsapp_connected,
      exists(
        select 1 from template
        where ${scoped(
          schema.template.organizationId,
          organizationId,
          sql`template.status = 'approved'`
        )}
      ) as template_approved,
      exists(
        select 1 from agent_profile
        where ${scoped(
          schema.agentProfile.organizationId,
          organizationId,
          sql`btrim(coalesce(agent_profile.instructions, '')) <> ''`,
          sql`exists (
            select 1 from kb_entry
            where kb_entry.organization_id = agent_profile.organization_id
          )`
        )}
      ) as agent_configured,
      exists(
        select 1 from agent_test_run
        where ${scoped(
          schema.agentTestRun.organizationId,
          organizationId,
          sql`agent_test_run.status = 'done'`
        )}
      ) as lab_run_done,
      exists(
        select 1 from agent_profile
        where ${scoped(
          schema.agentProfile.organizationId,
          organizationId,
          sql`agent_profile.enabled`
        )}
      ) as agent_enabled
  `);

  const row = rows[0];
  const steps = {
    whatsappConnected: row?.whatsapp_connected ?? false,
    templateApproved: row?.template_approved ?? false,
    agentConfigured: row?.agent_configured ?? false,
    labRunDone: row?.lab_run_done ?? false,
    agentEnabled: row?.agent_enabled ?? false,
  };
  return {
    ...steps,
    allDone:
      steps.whatsappConnected &&
      steps.templateApproved &&
      steps.agentConfigured &&
      steps.labRunDone &&
      steps.agentEnabled,
  };
}
