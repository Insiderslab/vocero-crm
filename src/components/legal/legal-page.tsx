import type { Metadata } from "next";
import { getPublicLocale } from "@/lib/i18n/server";
import { messagesFor } from "@/lib/i18n/messages";
import {
  fillLegal,
  LEGAL_LAST_UPDATED,
  legalContext,
  legalTextsReviewed,
  type LegalKind,
} from "@/lib/legal";

/** Contenuto di una pagina legale nella lingua del visitatore (cookie, poi Accept-Language). */
async function loadDocument(kind: LegalKind) {
  const locale = await getPublicLocale();
  const legal = messagesFor(locale).legal;
  return { locale, legal, doc: legal[kind], ctx: legalContext() };
}

export async function legalMetadata(kind: LegalKind): Promise<Metadata> {
  const { doc, ctx } = await loadDocument(kind);
  return {
    title: `${doc.title} — ${ctx.product}`,
    description: fillLegal(doc.summary, ctx),
  };
}

/**
 * Pagina pubblica, senza sessione: nessun dato di organizzazione, solo testo.
 */
export async function LegalPage({ kind }: { kind: LegalKind }) {
  const { legal, doc, ctx } = await loadDocument(kind);
  const draft = !legalTextsReviewed();
  return (
    <article>
      {draft && (
        <p
          role="note"
          data-legal-draft
          className="mb-6 rounded border px-4 py-3 text-sm font-semibold"
          style={{ borderColor: "var(--heili-line)", background: "var(--heili-panel)" }}
        >
          {legal.chrome.draftNotice}
        </p>
      )}
      <h1
        className="text-3xl font-semibold tracking-tight"
        style={{ fontFamily: "var(--heili-font-display)" }}
      >
        {doc.title}
      </h1>
      <p className="mt-3 text-base" style={{ color: "var(--heili-muted)" }}>
        {fillLegal(doc.summary, ctx)}
      </p>
      <p className="mt-2 text-xs" style={{ color: "var(--heili-soft)" }}>
        {legal.chrome.lastUpdated}:{" "}
        <time dateTime={LEGAL_LAST_UPDATED}>{LEGAL_LAST_UPDATED}</time>
        {draft && ` (${legal.chrome.draftLabel})`}
      </p>
      {doc.sections.map((section) => (
        <section key={section.title} className="mt-8">
          <h2 className="text-xl font-semibold">{section.title}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="mt-3 leading-relaxed">
              {fillLegal(paragraph, ctx)}
            </p>
          ))}
          {section.list.length > 0 && (
            <ul className="mt-3 list-disc space-y-1.5 pl-6 leading-relaxed">
              {section.list.map((item) => (
                <li key={item}>{fillLegal(item, ctx)}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </article>
  );
}
