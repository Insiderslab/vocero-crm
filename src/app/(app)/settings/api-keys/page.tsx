import { ApiKeysClient } from "@/components/settings/api-keys-client";
import { getSessionOrNull } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { canManageApiKeys } from "@/server/api-keys-admin";

export const dynamic = "force-dynamic";

export default async function ApiKeysSettingsPage() {
  // La API ya exige owner/admin; aquí además no se pinta la gestión para el resto.
  const session = await getSessionOrNull();
  if (!session || !canManageApiKeys(session.role)) {
    const { t } = await getT();
    return (
      <p className="max-w-2xl text-sm text-muted-foreground">
        {t("settings.apiKeys.forbidden")}
      </p>
    );
  }
  return (
    <div className="max-w-2xl space-y-8">
      <ApiKeysClient scope="bot" />
      <ApiKeysClient scope="export" />
    </div>
  );
}
