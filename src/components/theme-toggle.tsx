"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import {
  nextThemePreference,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  type ThemePreference,
} from "@/lib/theme";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const ICONS = { light: Sun, dark: Moon } as const;

/** Botón que alterna Claro ⇄ Oscuro y persiste la elección en cookie. */
export function ThemeToggle({
  initial,
  className,
}: {
  initial: ThemePreference;
  className?: string;
}) {
  const [pref, setPref] = useState<ThemePreference>(initial);

  function cycle() {
    const value = nextThemePreference(pref);
    setPref(value);
    document.documentElement.setAttribute("data-theme", value);
    document.cookie = `${THEME_COOKIE}=${value};path=/;max-age=${THEME_COOKIE_MAX_AGE};samesite=lax`;
  }

  const { t } = useT();
  const Icon = ICONS[pref];
  // 009 (E2): la etiqueta va en el idioma de la interfaz (antes, en español).
  const label = t("nav.theme", {
    label: pref === "dark" ? t("nav.themeDark") : t("nav.themeLight"),
  });

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className={cn(
        "rounded p-1 text-text-3 transition-colors hover:text-foreground",
        className
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.7} />
    </button>
  );
}
