"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { canManageApiKeys } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/role-context";

const TABS = [
  { href: "/settings/whatsapp", key: "whatsapp" },
  { href: "/settings/branding", key: "branding" },
  { href: "/settings/templates", key: "templates" },
  { href: "/settings/team", key: "team" },
  { href: "/settings/api-keys", key: "apiKeys" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  const { t } = useT();
  // Pestaña de claves API solo para quien puede gestionarlas (la página y la API lo exigen igual).
  const canSeeApiKeys = canManageApiKeys(useRole());
  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-44 sm:flex-col sm:space-y-1 sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3">
      {TABS.filter((tab) => tab.key !== "apiKeys" || canSeeApiKeys).map((tab) => (
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
