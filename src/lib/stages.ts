import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/lib/i18n";
import { messagesFor } from "@/lib/i18n/messages";

/**
 * 009 (E2) — Etapas de fábrica del pipeline.
 *
 * Los NOMBRES de las etapas son datos de cada organización (el dueño los
 * renombra), pero las cinco de fábrica se sembraban siempre en español
 * ("Nuevo", "En conversación"…) y una organización italiana veía el tablero a
 * medio traducir. Ahora:
 * - una organización nueva se siembra en el idioma de quien la crea;
 * - al MOSTRAR, una etapa que conserva exactamente un nombre de fábrica (en
 *   cualquiera de los tres idiomas) se enseña traducida al idioma de la
 *   interfaz; una renombrada se enseña tal como se escribió.
 * Nada de esto reescribe datos existentes.
 */

export const DEFAULT_STAGE_KEYS = ["new", "talking", "interested", "won", "lost"] as const;
export type DefaultStageKey = (typeof DEFAULT_STAGE_KEYS)[number];

const KIND: Record<DefaultStageKey, "open" | "won" | "lost"> = {
  new: "open",
  talking: "open",
  interested: "open",
  won: "won",
  lost: "lost",
};

/** Nombre de fábrica de una etapa en un idioma. */
export function defaultStageName(key: DefaultStageKey, locale: Locale): string {
  return messagesFor(locale).pipeline.defaultStages[key];
}

/** Las cinco etapas de una organización nueva, en su idioma. */
export function seedStages(
  locale: Locale = DEFAULT_LOCALE
): { name: string; kind: "open" | "won" | "lost" }[] {
  return DEFAULT_STAGE_KEYS.map((key) => ({
    name: defaultStageName(key, locale),
    kind: KIND[key],
  }));
}

/**
 * ¿Es este nombre EXACTAMENTE uno de fábrica (en cualquier idioma)? Devuelve
 * cuál. Comparación exacta a propósito: "Nuevo cliente" o "nuevo" son
 * nombres del dueño y se respetan tal cual.
 */
export function defaultStageKeyOf(name: string | null | undefined): DefaultStageKey | null {
  if (!name) return null;
  for (const locale of LOCALES) {
    for (const key of DEFAULT_STAGE_KEYS) {
      if (defaultStageName(key, locale) === name) return key;
    }
  }
  return null;
}

/** Cómo se muestra una etapa en el idioma de la interfaz. */
export function stageLabel(name: string, locale: Locale): string {
  const key = defaultStageKeyOf(name);
  return key ? defaultStageName(key, locale) : name;
}

/**
 * ¿Lo escrito en el gestor de etapas es un renombre de verdad? El campo enseña
 * la etiqueta traducida de una etapa de fábrica: dejarlo igual (o igual al
 * dato guardado) NO la renombra — si no, abrir y cerrar el gestor en italiano
 * reescribiría "Nuevo" como "Nuovo" en la base de datos.
 */
export function isStageRename(typed: string, stored: string, locale: Locale): boolean {
  const v = typed.trim();
  if (!v) return false;
  return v !== stored && v !== stageLabel(stored, locale);
}
