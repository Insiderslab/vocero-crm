import { WapiKeyCard } from "@/components/settings/wapi-key-card";
import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";
import { getSessionOrNull } from "@/lib/auth/session";
import { canManageApiKeys } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function WhatsappSettingsPage() {
  // La API de la clave Wapi ya exige owner/admin; aquí además no se pinta
  // la tarjeta para el resto.
  const session = await getSessionOrNull();
  return (
    <div className="max-w-3xl space-y-6">
      <WhatsappWizard />
      {session && canManageApiKeys(session.role) && <WapiKeyCard />}
    </div>
  );
}
