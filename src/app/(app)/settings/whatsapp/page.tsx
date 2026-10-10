import { WapiKeyCard } from "@/components/settings/wapi-key-card";
import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";
import { getSessionOrNull } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { canManageWhatsapp } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function WhatsappSettingsPage() {
  // La API ya exige owner/admin; aquí además no se pinta nada para el resto.
  const session = await getSessionOrNull();
  if (!session || !canManageWhatsapp(session.role)) {
    const { t } = await getT();
    return (
      <p className="max-w-2xl text-sm text-muted-foreground">
        {t("settings.whatsapp.forbidden")}
      </p>
    );
  }
  return (
    <div className="max-w-3xl space-y-6">
      <WhatsappWizard />
      <WapiKeyCard />
    </div>
  );
}
