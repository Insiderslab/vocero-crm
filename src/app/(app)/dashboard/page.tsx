import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export const dynamic = "force-dynamic";

/**
 * 010 — «Sintesi»: vista de conjunto de la organización. La ven todos los
 * miembros (la rotta API lo exige igual). La página inicial después del login
 * NO cambia: esto es una pantalla más del menú.
 */
export default async function DashboardPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const { t } = await getT();

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="font-semibold">{t("dashboard.title")}</h2>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        <DashboardClient />
      </div>
    </div>
  );
}
