"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import type { Branding } from "@/lib/branding";
import { useT } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n";
import type { ThemePreference } from "@/lib/theme";
import { AppNav } from "@/components/app-nav";
import { HeiliMark } from "@/components/heili-mark";

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
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useT();
  const [navOpen, setNavOpen] = useState(false);

  // Navegar = cerrar el cajón. Sin esto, tocar "Pipeline" deja el velo encima
  // de la pantalla recién cargada.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
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
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 lg:hidden">
          <button
            onClick={() => setNavOpen(true)}
            aria-label={t("nav.openMenu")}
            aria-expanded={navOpen}
            className="rounded-md p-2 text-text-2 hover:bg-accent hover:text-foreground"
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

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
