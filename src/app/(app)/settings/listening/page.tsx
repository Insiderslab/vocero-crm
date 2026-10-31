import { ListeningClient } from "@/components/settings/listening-client";
import { getSessionOrNull } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { isOrgAdmin } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ListeningSettingsPage() {
  // La API ya exige owner/admin; aquí además no se pinta el interruptor al resto.
  const session = await getSessionOrNull();
  if (!session || !isOrgAdmin(session.role)) {
    const { t } = await getT();
    return <p className="max-w-2xl text-sm text-muted-foreground">{t("settings.listening.forbidden")}</p>;
  }
  return (
    <div className="max-w-2xl">
      <ListeningClient />
    </div>
  );
}
