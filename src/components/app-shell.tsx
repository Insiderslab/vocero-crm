"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Menu, Sparkles } from "lucide-react";
import type { Branding } from "@/lib/branding";
import { useT } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n";
import type { ThemePreference } from "@/lib/theme";
import { AppNav } from "@/components/app-nav";
import { HandoffAlerts } from "@/components/handoff-alerts";
import { HeiliMark } from "@/components/heili-mark";
import { RoleProvider } from "@/components/role-context";
import { WebhookRouteShellAlert } from "@/components/settings/webhook-route-alert";
import { canManageWhatsapp } from "@/lib/roles";
import type { WorkspaceProfile } from "@/lib/workspace/profile";

/**
 * Cascarón de la app en dos modos:
 *
 * - Escritorio (lg+): el panel lateral es una columna fija, como siempre.
 * - Móvil/tableta: el lateral sale de la izquierda como cajón sobre un velo,
 *   y arriba queda una barra con el hamburguesa y la marca. El cajón se cierra
 *   solo al navegar (el `pathname` cambia) y con Escape.
 *
 * La altura usa `100dvh` (no `100vh`) porque en el navegador móvil la barra de
 * direcciones se encoge al hacer scroll: con `vh` el compositor de la Bandeja
 * queda debajo del borde visible.
 */
export function AppShell({
  branding,
  userName,
  role,
  theme,
  commit,
  orgs,
  activeOrgId,
  isSuperadmin,
  locale,
  profile = "standard",
  children,
}: {
  branding: Branding;
  userName: string;
  role: string;
  theme: ThemePreference;
  /** Commit resuelto en el servidor (build-arg o variable de la plataforma). */
  commit?: string;
  /** Multi-org: empresas del usuario y la activa (selector del lateral). */
  orgs?: { id: string; name: string }[];
  activeOrgId?: string;
  isSuperadmin?: boolean;
  locale: Locale;
  profile?: WorkspaceProfile;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useT();
  const [navOpen, setNavOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const inDailyWorkspace = pathname === "/oggi" || pathname.startsWith("/agenda");

  // Navegar = cerrar el cajón. Sin esto, tocar "Pipeline" deja el velo encima
  // de la pantalla recién cargada.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const opener = menuButton.current;
    const drawer = shell.current?.querySelector<HTMLElement>("aside");
    const controls = () => [...(drawer?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),select,input,[tabindex="0"]') ?? [])].filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
    controls()[0]?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
      if (e.key === "Tab") {
        const items = controls();
        const first = items[0], last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus({ preventScroll: true });
    };
  }, [navOpen]);

  return (
    <div ref={shell} className="flex h-dvh overflow-hidden bg-background">
      {navOpen && (
        <button
          aria-label={t("nav.closeMenu")}
          tabIndex={-1}
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-overlay lg:hidden"
        />
      )}

      <AppNav
        branding={branding}
        commit={commit}
        userName={userName}
        role={role}
        theme={theme}
        orgs={orgs}
        activeOrgId={activeOrgId}
        isSuperadmin={isSuperadmin}
        locale={locale}
        profile={profile}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <div inert={navOpen || undefined} className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 lg:hidden">
          <button
            ref={menuButton}
            onClick={() => setNavOpen(true)}
            aria-label={t("nav.openMenu")}
            aria-expanded={navOpen}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-text-2 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Menu className="h-5 w-5" strokeWidth={1.8} />
          </button>
          <HeiliMark size={26} className="shrink-0" />
          <span
            className="truncate text-[15px] font-[650] tracking-tight"
            style={{ fontFamily: "var(--heili-font-display)" }}
          >
            {branding.name}
          </span>
        </header>
        {inDailyWorkspace && <nav aria-label="Accessi rapidi" className="flex shrink-0 gap-2 border-b bg-subtle px-3 py-2 lg:hidden">
          {[{ href: "/oggi", label: t("nav.oggi"), Icon: Sparkles }, { href: "/agenda", label: t("nav.agenda"), Icon: CalendarDays }].map(({ href, label, Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${pathname === href ? "bg-brand-tint text-brand-text" : "text-text-2 hover:bg-accent"}`}><Icon className="h-4 w-4" aria-hidden="true" />{label}</Link>)}
        </nav>}

        {profile === "marine" && <p role="status" className="border-b bg-warning-tint px-4 py-2 text-sm text-warning-text">Piloto: puedes probar el CRM y los tours. Los envíos, la conexión de WhatsApp y la carga de archivos están desactivados.</p>}

        {/* 014 — I messaggi WhatsApp non arrivano al CRM: barra rossa ovunque
            (owner/admin), tranne nella pagina WhatsApp che ha l'avviso completo. */}
        {canManageWhatsapp(role) && !pathname.startsWith("/settings/whatsapp") && (
          <WebhookRouteShellAlert />
        )}

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <RoleProvider value={role}>{children}</RoleProvider>
        </main>
      </div>

      {/* 009 (E1d): avisos de handoff en cualquier pantalla. */}
      <div inert={navOpen || undefined}><HandoffAlerts /></div>
    </div>
  );
}
