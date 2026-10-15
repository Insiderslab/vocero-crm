import Link from "next/link";
import { WhatsappGuide } from "@/components/settings/whatsapp-guide";
import { getSessionOrNull } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { canManageWhatsapp } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function WhatsappSettingsPage() {
  // La API ya exige owner/admin; aquí además no se pinta nada para el resto.
  const session = await getSessionOrNull();
  const { t } = await getT();
  if (!session || !canManageWhatsapp(session.role)) {
    return (
      <p className="max-w-2xl text-sm text-muted-foreground">
        {t("settings.whatsapp.forbidden")}
      </p>
    );
  }
  return (
    <div className="max-w-3xl space-y-6">
      {/* 013 — Guida in 3 passi; WABA, token, webhook e chiave Wapi in «Avanzate». */}
      <WhatsappGuide />
      {/* 010 — reabrir la checklist «Primi passi» cuando ya está completa. */}
      <p className="text-sm text-muted-foreground">
        {t("onboarding.reopenDescription")}{" "}
        <Link
          href="/dashboard?primi-passi=1"
          className="font-medium text-brand-text underline-offset-2 hover:underline"
        >
          {t("onboarding.reopen")}
        </Link>
      </p>
    </div>
  );
}
