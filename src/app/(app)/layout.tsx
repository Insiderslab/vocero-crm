import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull } from "@/lib/auth/session";
import { LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import { listUserOrgs } from "@/server/auth/orgs";
import { isSuperadminEmail } from "@/server/auth/superadmin";
import { AppShell } from "@/components/app-shell";
import { resolveBuildCommit } from "@/lib/version";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const branding = await getBranding(session.organizationId);
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });
  const jar = await cookies();
  const theme = normalizeThemePreference(jar.get(THEME_COOKIE)?.value);
  const locale = normalizeLocale(jar.get(LOCALE_COOKIE)?.value);
  // Multi-org: empresas del usuario para el selector del lateral.
  const orgs = await listUserOrgs(session.userId);
  const superadmin = isSuperadminEmail(authSession?.user.email);

  return (
    <AppShell
      branding={branding}
      userName={authSession?.user.name ?? "Usuario"}
      role={session.role}
      theme={theme}
      orgs={orgs}
      activeOrgId={session.organizationId}
      isSuperadmin={superadmin}
      locale={locale}
      // Se resuelve aquí, en el servidor: el cliente no ve `SOURCE_COMMIT`.
      commit={resolveBuildCommit()}
    >
      {children}
    </AppShell>
  );
}
