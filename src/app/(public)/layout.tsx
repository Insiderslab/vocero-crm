import Link from "next/link";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { getPublicLocale } from "@/lib/i18n/server";
import { messagesFor } from "@/lib/i18n/messages";
import { LEGAL_PATHS, legalContext } from "@/lib/legal";
import { HeiliMark } from "@/components/heili-mark";
import { LocaleToggle } from "@/components/locale-toggle";

/**
 * Guscio delle pagine pubbliche (privacy, termini, cancellazione dati).
 * Volutamente senza sessione e senza database: le legge anche il verificatore
 * di Meta. Per questo usa la marca predefinita e non quella di un'organizzazione.
 */
export default async function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getPublicLocale();
  const { chrome } = messagesFor(locale).legal;
  const { entity, email } = legalContext();
  return (
    <div
      lang={locale}
      className="flex min-h-screen flex-col"
      style={{ background: "var(--heili-paper)", color: "var(--heili-ink)" }}
    >
      <a
        href="#contenuto"
        className="sr-only focus:not-sr-only focus:p-3 focus:underline"
      >
        {chrome.skipToContent}
      </a>
      <header
        className="border-b"
        style={{ borderColor: "var(--heili-line)", background: "var(--heili-panel)" }}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/login" className="flex items-center gap-3">
            <HeiliMark size={32} className="text-[var(--heili-verde-brand)]" />
            <span
              className="text-lg font-semibold tracking-tight"
              style={{ fontFamily: "var(--heili-font-display)" }}
            >
              {DEFAULT_BRANDING.name}
            </span>
          </Link>
          <LocaleToggle initial={locale} />
        </div>
      </header>
      <main id="contenuto" className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        {children}
      </main>
      <footer
        className="border-t"
        style={{ borderColor: "var(--heili-line)", background: "var(--heili-panel)" }}
      >
        <div className="mx-auto max-w-3xl space-y-3 px-4 py-6 text-sm">
          <nav aria-label={chrome.nav} className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href={LEGAL_PATHS.privacy} className="underline">
              {chrome.privacy}
            </Link>
            <Link href={LEGAL_PATHS.terms} className="underline">
              {chrome.terms}
            </Link>
            <Link href={LEGAL_PATHS.deletion} className="underline">
              {chrome.deletion}
            </Link>
            <Link href="/login" className="underline">
              {chrome.login}
            </Link>
          </nav>
          <p style={{ color: "var(--heili-muted)" }}>
            {entity} · {email}
          </p>
        </div>
      </footer>
    </div>
  );
}
