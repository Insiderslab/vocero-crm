import { SiteClient } from "@/components/settings/site-client";
import { getSessionOrNull } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { canManageSiteForm } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function SiteSettingsPage() {
  // La API ya exige owner/admin; aquí además no se pinta la gestión para el resto.
  const session = await getSessionOrNull();
  if (!session || !canManageSiteForm(session.role)) {
    const { t } = await getT();
    return <p className="max-w-2xl text-sm text-muted-foreground">{t("settings.site.forbidden")}</p>;
  }
  return (
    <div className="max-w-2xl">
      <SiteClient />
    </div>
  );
}
