import { intlLocale, type Locale } from "@/lib/i18n";
import { fillLegal, type LegalContext, type LegalMessages, type PublicDeletionStatus } from "@/lib/legal";

/**
 * 015 — Riquadro di stato su /cancellazione-dati?id=<codice>. Vista pura: lo
 * stato lo legge la pagina. Mostra solo stato e date, mai l'ID Meta.
 * `state`: lo stato trovato, "not_found" (codice assente o malformato) o
 * "unavailable" (database non raggiungibile).
 */
export function DeletionStatusBox({
  code,
  state,
  messages,
  ctx,
  locale,
}: {
  code: string;
  state: PublicDeletionStatus | "not_found" | "unavailable";
  messages: LegalMessages["status"];
  ctx: LegalContext;
  locale: Locale;
}) {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long", timeZone: "Europe/Rome" }).format(
      new Date(iso)
    );
  const box = "mt-6 rounded border px-4 py-4";
  const style = { borderColor: "var(--heili-line)", background: "var(--heili-panel)" };
  if (state === "not_found" || state === "unavailable") {
    return (
      <section role="status" data-deletion-status={state} className={box} style={style}>
        <h2 className="text-xl font-semibold">{messages.title}</h2>
        <p className="mt-3">
          {state === "not_found" ? fillLegal(messages.notFound, ctx) : messages.unavailable}
        </p>
      </section>
    );
  }
  const hint =
    state.status === "completed"
      ? messages.completedHint
      : state.status === "in_progress"
        ? messages.inProgressHint
        : messages.receivedHint;
  return (
    <section role="status" data-deletion-status={state.status} className={box} style={style}>
      <h2 className="text-xl font-semibold">{messages.title}</h2>
      <p className="mt-3 text-lg font-semibold">{messages[state.status]}</p>
      <p className="mt-1">{hint}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt style={{ color: "var(--heili-muted)" }}>{messages.code}</dt>
        <dd className="font-mono">{code}</dd>
        <dt style={{ color: "var(--heili-muted)" }}>{messages.receivedOn}</dt>
        <dd>{fmt(state.createdAt)}</dd>
        {state.completedAt ? (
          <>
            <dt style={{ color: "var(--heili-muted)" }}>{messages.completedOn}</dt>
            <dd>{fmt(state.completedAt)}</dd>
          </>
        ) : (
          <>
            <dt style={{ color: "var(--heili-muted)" }}>{messages.updatedOn}</dt>
            <dd>{fmt(state.updatedAt)}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
