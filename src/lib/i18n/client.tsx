"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { translate } from "@/lib/i18n/t";
import { messagesFor, type Messages } from "@/lib/i18n/messages";

export type TFunction = (
  key: string,
  vars?: Record<string, string | number>
) => string;

const I18nContext = createContext<{ locale: Locale; t: TFunction }>({
  locale: DEFAULT_LOCALE,
  t: (key) => key,
});

/**
 * Proveedor de idioma. Recibe el locale resuelto en el servidor (cookie) y
 * selecciona el diccionario estáticamente — los tres viajan en el bundle,
 * que es pequeño comparado con el JS de la app.
 */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = useMemo(() => {
    const messages: Messages = messagesFor(locale);
    return {
      locale,
      t: (key: string, vars?: Record<string, string | number>) =>
        translate(messages as Record<string, unknown>, key, vars),
    };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Hook de traducción para componentes cliente. */
export function useT(): { locale: Locale; t: TFunction } {
  return useContext(I18nContext);
}
