import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
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
