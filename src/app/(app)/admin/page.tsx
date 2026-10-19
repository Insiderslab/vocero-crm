import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { isSuperadminEmail } from "@/server/auth/superadmin";
import { getT } from "@/lib/i18n/server";
import { AdminClient } from "@/components/admin/admin-client";
import { MetaDeletionCard } from "@/components/admin/meta-deletion-card";
import { MetaPlatformCard } from "@/components/admin/meta-platform-card";

export const dynamic = "force-dynamic";

/**
 * Panel admin multi-empresa (custom heili.cloud). Solo super-admin: cualquier
 * otro usuario va a su bandeja. La API vuelve a verificar — esto es solo UX.
 */
export default async function AdminPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (!isSuperadminEmail(session.user.email)) redirect("/inbox");
  const { t } = await getT();

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="font-semibold">{t("admin.orgs.title")}</h2>
      </header>
      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-4 sm:p-6">
        {/* 013 — Piattaforma → Meta: App ID e Configuration ID senza SSH. */}
        <section aria-labelledby="admin-platform-title" className="max-w-3xl space-y-3">
          <h3 id="admin-platform-title" className="text-sm font-semibold text-muted-foreground">
            {t("admin.platform.sectionTitle")}
          </h3>
          <MetaPlatformCard />
        </section>
        {/* 015 — Richieste di cancellazione dati arrivate da Meta. */}
        <section aria-labelledby="admin-privacy-title" className="max-w-3xl space-y-3">
          <h3 id="admin-privacy-title" className="text-sm font-semibold text-muted-foreground">
            {t("admin.deletion.sectionTitle")}
          </h3>
          <MetaDeletionCard />
        </section>
        <AdminClient />
      </div>
    </div>
  );
}
