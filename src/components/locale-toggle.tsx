"use client";

import { useRouter } from "next/navigation";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  nextLocale,
  type Locale,
} from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Selector de idioma: cicla es → en → it y persiste en cookie (mismo patrón
 * que el tema). El refresh re-lee la cookie en el servidor y toda la app
 * cambia de idioma — incluidos los server components.
 */
export function LocaleToggle({
  initial,
  className,
}: {
  initial: Locale;
  className?: string;
}) {
  const router = useRouter();

  function cycle() {
    const value = nextLocale(initial);
    document.cookie = `${LOCALE_COOKIE}=${value};path=/;max-age=${LOCALE_COOKIE_MAX_AGE};samesite=lax`;
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label="Language / Idioma / Lingua"
      title="Language / Idioma / Lingua"
      className={cn(
        "rounded px-1 py-0.5 text-[11px] font-bold uppercase tracking-wide text-text-3 transition-colors hover:text-foreground",
        className
      )}
    >
      {initial}
    </button>
  );
}
