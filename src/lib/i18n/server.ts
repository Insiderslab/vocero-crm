import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALES,
  negotiateLocale,
  normalizeLocale,
  type Locale,
} from "@/lib/i18n";
import { translate } from "@/lib/i18n/t";
import { messagesFor, type Messages } from "@/lib/i18n/messages";

/** Locale de la petición (cookie). Server components y route handlers. */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return normalizeLocale(value ?? DEFAULT_LOCALE);
}

/**
 * Idioma de las páginas PÚBLICAS: cookie válida; sin cookie válida, cabecera
 * Accept-Language (es/en/it); si no, default. Solo para el perímetro público:
 * la app autenticada sigue con getLocale() (solo cookie).
 */
export async function getPublicLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  if ((LOCALES as readonly string[]).includes(value ?? "")) return value as Locale;
  return negotiateLocale((await headers()).get("accept-language"));
}

/** t() listo para server components. */
export async function getT(): Promise<{
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
}> {
  const locale = await getLocale();
  const messages: Messages = messagesFor(locale);
  return {
    locale,
    t: (key, vars) =>
      translate(messages as Record<string, unknown>, key, vars),
  };
}
