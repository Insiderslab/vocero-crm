import { adminOnly } from "@/components/admin-only";
import { getSessionOrNull } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { isOrgAdmin } from "@/lib/roles";
import {
  getOnboardingChecklist,
  showOnboardingChecklist,
} from "@/server/onboarding/checklist";
import { AutomationsClient } from "@/components/automations/automations-client";
import { PrimiPassi } from "@/components/onboarding/primi-passi";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const session = await getSessionOrNull();
  const isAdmin = session ? isOrgAdmin(session.role) : false;
  // La checklist se calcula solo para quien puede verla: un member no toca la BD por esto.
  const checklist =
    session && isAdmin ? await getOnboardingChecklist(session.organizationId) : null;
  const { t } = await getT();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="font-semibold">{t("admin.automations.title")}</h2>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        {session && checklist && showOnboardingChecklist(session.role, checklist, false) && (
          <PrimiPassi checklist={checklist} t={t} />
        )}
        {await adminOnly(
          <AutomationsClient
            onboarding={
              checklist
                ? {
                    whatsappConnected: checklist.whatsappConnected,
                    templateApproved: checklist.templateApproved,
                  }
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
