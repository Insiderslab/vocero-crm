/**
 * i18n (custom heili.cloud): Español (default), English, Italiano.
 *
 * La preferencia es POR DISPOSITIVO (cookie), igual que el tema: no requiere
 * migración y cada usuario de la misma empresa puede ver su idioma.
 *
 * Los diccionarios viven en messages/<locale>/ divididos por módulo (así
 * varios frentes de trabajo no pisan un archivo único). `es` es la fuente de
 * la FORMA: en/it deben tener las mismas llaves o el typecheck falla.
 */

export const LOCALES = ["es", "en", "it"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "it";
export const LOCALE_COOKIE = "heili-locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const LOCALE_LABELS: Record<Locale, string> = {
  es: "Español",
  en: "English",
  it: "Italiano",
};

/** Cookie ausente o manipulada → default. Nunca lanza. */
export function normalizeLocale(value: string | null | undefined): Locale {
  return (LOCALES as readonly string[]).includes(value ?? "")
    ? (value as Locale)
    : DEFAULT_LOCALE;
}

/**
 * Idioma desde la cabecera Accept-Language (solo páginas públicas sin cookie).
 * Respeta los pesos q; ignora tags desconocidos o mal formados; nunca lanza.
 * Sin coincidencia → default.
 */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked: { locale: Locale; q: number; order: number }[] = [];
  header.slice(0, 500).split(",").forEach((part, order) => {
    const [tag = "", ...params] = part.trim().split(";");
    const base = tag.trim().toLowerCase().split("-")[0] ?? "";
    if (!(LOCALES as readonly string[]).includes(base)) return;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) q = Number.parseFloat(m[1]!);
    }
    if (!Number.isFinite(q) || q <= 0 || q > 1) return;
    ranked.push({ locale: base as Locale, q, order });
  });
  ranked.sort((a, b) => b.q - a.q || a.order - b.order);
  return ranked[0]?.locale ?? DEFAULT_LOCALE;
}

/** Siguiente idioma del botón: es → en → it → es. */
export function nextLocale(current: Locale): Locale {
  const i = LOCALES.indexOf(current);
  return LOCALES[(i + 1) % LOCALES.length]!;
}
