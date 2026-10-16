import { intlLocale, type Locale } from "@/lib/i18n";

/**
 * 012 — Riga di sola lettura «Ronda: ultima inviata il … a N persone (esito)»
 * nella sezione Accesso riservato. Pura (senza React) per poterla provare.
 */

export type LastBroadcast = {
  at: string;
  status: "running" | "done";
  total: number;
  sent: number;
  failed: number;
  skipped: number;
};

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function rondaLine(
  t: Translate,
  locale: Locale,
  last: LastBroadcast | null
): string {
  if (!last) return t("agent.restricted.ronda.none");
  const date = new Date(last.at).toLocaleString(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const outcome =
    last.status === "running"
      ? t("agent.restricted.ronda.running")
      : last.sent === last.total
        ? t("agent.restricted.ronda.allSent")
        : t("agent.restricted.ronda.partial", { sent: last.sent, total: last.total });
  return t(last.total === 1 ? "agent.restricted.ronda.lastOne" : "agent.restricted.ronda.last", {
    date,
    count: last.total,
    outcome,
  });
}
