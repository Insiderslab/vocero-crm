import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import {
  getOnboardingChecklist,
  showOnboardingChecklist,
} from "@/server/onboarding/checklist";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { PrimiPassi } from "@/components/onboarding/primi-passi";

export const dynamic = "force-dynamic";

/**
 * 010 — «Sintesi»: vista de conjunto de la organización. La ven todos los
 * miembros (la rotta API lo exige igual); la tarjeta «Primi passi» solo a
 * owner/admin. La página inicial después del login NO cambia: esto es una
 * pantalla más del menú.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const { t } = await getT();
  const checklist = await getOnboardingChecklist(session.organizationId);
  const params = await searchParams;
  const reopened = params["primi-passi"] === "1";

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="font-semibold">{t("dashboard.title")}</h2>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        {showOnboardingChecklist(session.role, checklist, reopened) && (
          <PrimiPassi checklist={checklist} t={t} />
        )}
        <DashboardClient />
      </div>
    </div>
  );
}
