import { InboxClient } from "@/components/inbox/inbox-client";
import { getSessionOrNull } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { isListeningMode } from "@/server/listening/mode";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  // 016: con la modalità ascolto accesa una striscia lo dice a chiunque apra la Posta.
  const session = await getSessionOrNull();
  const listening = session ? await isListeningMode(session.organizationId) : false;
  if (!listening) return <InboxClient />;
  const { t } = await getT();
  return (
    <div className="flex h-full flex-col">
      <div
        role="status"
        className="shrink-0 border-b bg-brand-tint px-4 py-2 text-sm font-medium text-brand-text"
      >
        {t("inbox.listeningBanner")}
      </div>
      <div className="min-h-0 flex-1">
        <InboxClient />
      </div>
    </div>
  );
}
