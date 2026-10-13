import { AlertTriangle, ShieldCheck } from "lucide-react";
import type { TFunction } from "@/lib/i18n/client";
import { intlLocale, type Locale } from "@/lib/i18n";

/** Contadores del proceso que devuelve GET /api/settings/webhook. */
export type SignatureStats = {
  lastVerifiedAt: string | null;
  lastInvalidAt: string | null;
  invalidSinceBoot: number;
};

/** «hace 5 minutos» / «5 minutes ago» / «5 minuti fa». */
export function formatAgo(iso: string, locale: Locale, now: number = Date.now()): string {
  const diffS = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  const abs = Math.abs(diffS);
  if (abs < 60) return rtf.format(diffS, "second");
  if (abs < 3600) return rtf.format(Math.round(diffS / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diffS / 3600), "hour");
  return rtf.format(Math.round(diffS / 86_400), "day");
}

/**
 * Estado REAL de la firma (con secreto configurado): no basta con que haya un
 * secreto, tiene que coincidir con la app que firma. Se muestra la última
 * firma verificada y, si hubo rechazos, cuántos (desde el arranque).
 */
export function WebhookSignatureStatus({
  stats,
  t,
  locale,
  now,
}: {
  stats: SignatureStats | undefined;
  t: TFunction;
  locale: Locale;
  now?: number;
}) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-2 text-xs text-success">
        <ShieldCheck className="h-4 w-4" /> {t("settings.whatsapp.signatureActive")}
      </p>
      {stats && (
        <p className="text-xs text-muted-foreground" data-testid="signature-last-verified">
          {stats.lastVerifiedAt
            ? t("settings.whatsapp.signatureLastVerified", {
                when: formatAgo(stats.lastVerifiedAt, locale, now),
              })
            : t("settings.whatsapp.signatureNoneVerified")}
        </p>
      )}
      {stats && stats.invalidSinceBoot > 0 && (
        <p
          role="alert"
          data-testid="signature-rejected"
          className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-xs text-warning-text"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("settings.whatsapp.signatureRejected", {
            count: stats.invalidSinceBoot,
            when: stats.lastInvalidAt ? formatAgo(stats.lastInvalidAt, locale, now) : "—",
          })}
        </p>
      )}
    </div>
  );
}
