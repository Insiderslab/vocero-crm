import { DeletionStatusBox } from "@/components/legal/deletion-status";
import { LegalPage, legalMetadata } from "@/components/legal/legal-page";
import { getPublicLocale } from "@/lib/i18n/server";
import { messagesFor } from "@/lib/i18n/messages";
import { legalContext } from "@/lib/legal";
import {
  deletionStatusByCode,
  isConfirmationCode,
  type PublicDeletionStatus,
} from "@/server/meta/data-deletion";

export const generateMetadata = () => legalMetadata("deletion");

type Props = { searchParams: Promise<{ id?: string | string[] }> };

/**
 * Senza `id`: le istruzioni. Con `?id=<codice>` (l'indirizzo che il callback
 * di Meta restituisce, 015): sopra le istruzioni, lo stato della richiesta.
 * Un codice malformato non arriva al database.
 */
export default async function Page({ searchParams }: Props) {
  const raw = (await searchParams).id;
  const code = typeof raw === "string" ? raw.trim() : "";
  if (!code) return <LegalPage kind="deletion" />;

  let state: PublicDeletionStatus | "not_found" | "unavailable" = "not_found";
  if (isConfirmationCode(code)) {
    try {
      state = (await deletionStatusByCode(code)) ?? "not_found";
    } catch (err) {
      console.error("[data-deletion] stato non leggibile:", err instanceof Error ? err.message : err);
      state = "unavailable";
    }
  }
  const locale = await getPublicLocale();
  return (
    <LegalPage
      kind="deletion"
      before={
        <DeletionStatusBox
          code={code.slice(0, 40)}
          state={state}
          messages={messagesFor(locale).legal.status}
          ctx={legalContext()}
          locale={locale}
        />
      }
    />
  );
}
