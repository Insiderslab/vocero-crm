"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { canManageApiKeys, canManageSiteForm, canManageWhatsapp, isOrgAdmin } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/role-context";

/**
 * `visibleFor`: regla de rol de la pestaña (ausente = la ven todos). Es solo
 * navegación: las páginas y la API exigen el mismo rol por su cuenta.
 */
const TABS = [
  { href: "/settings/whatsapp", key: "whatsapp", visibleFor: canManageWhatsapp },
  { href: "/settings/branding", key: "branding" },
  { href: "/settings/templates", key: "templates", visibleFor: isOrgAdmin },
  { href: "/settings/team", key: "team" },
  { href: "/settings/api-keys", key: "apiKeys", visibleFor: canManageApiKeys },
  { href: "/settings/site", key: "site", visibleFor: canManageSiteForm },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  const { t } = useT();
  // Sin proveedor de rol el rol es "" y no se pinta ninguna pestaña reservada (fail-closed).
  const role = useRole();
  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-44 sm:flex-col sm:space-y-1 sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3">
      {TABS.filter((tab) => !("visibleFor" in tab) || tab.visibleFor(role)).map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "block shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith(tab.href)
              ? "bg-brand-tint text-brand-text"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {t(`settings.tabs.${tab.key}`)}
        </Link>
      ))}
    </nav>
  );
}
