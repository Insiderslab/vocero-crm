import { getT } from "@/lib/i18n/server";
import { AutomationsClient } from "@/components/automations/automations-client";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const { t } = await getT();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="font-semibold">{t("admin.automations.title")}</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <AutomationsClient />
      </div>
    </div>
  );
}
