import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { isSuperadminEmail } from "@/server/auth/superadmin";
import { getT } from "@/lib/i18n/server";
import { AdminClient } from "@/components/admin/admin-client";

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
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <AdminClient />
      </div>
    </div>
  );
}
