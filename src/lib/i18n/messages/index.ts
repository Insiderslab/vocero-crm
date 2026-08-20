import type { Locale } from "@/lib/i18n";
import en from "./en";
import es from "./es";
import it from "./it";

export type Messages = typeof es;

/** Diccionario del locale pedido; el default es español. */
export function messagesFor(locale: Locale): Messages {
  if (locale === "en") return en;
  if (locale === "it") return it;
  return es;
}
