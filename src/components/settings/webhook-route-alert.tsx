"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { useT, type TFunction } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n";
import {
  webhookRouteAlarming,
  type WebhookRouteCheckResponse,
} from "@/lib/webhook-route";
import { Button } from "@/components/ui/button";
import { formatAgo } from "@/components/settings/webhook-signature-status";

/**
 * 014 — Guardia del webhook (owner/admin).
 *
 * - In Impostazioni → WhatsApp (`WebhookRouteAlert`): se Meta manda i
 *   messaggi a un altro sistema, avviso rosso con il rimedio; al super-admin
 *   il pulsante «Ripristina il collegamento al CRM». Se va tutto bene, una
 *   riga verde («controllato X fa»). Se il numero di solito riceve e da ore
 *   tace, un avviso giallo con «Controlla adesso».
 * - In tutta l'app (`WebhookRouteShellAlert`): una barra rossa con il link
 *   alla pagina, solo quando i messaggi non arrivano al CRM.
 */

const URL_CHECK = "/api/settings/whatsapp/route-check";
const URL_RESTORE = "/api/admin/platform/meta/webhook";
/** La barra in alto si ricontrolla ogni 15 minuti (il server tiene 10 minuti in cache). */
const SHELL_POLL_MS = 15 * 60 * 1000;

async function fetchCheck(opts: { refresh?: boolean; stats?: boolean } = {}): Promise<WebhookRouteCheckResponse | null> {
  const qs = new URLSearchParams();
  if (opts.refresh) qs.set("refresh", "1");
  if (opts.stats) qs.set("stats", "1");
  const query = qs.toString();
  const url = query ? `${URL_CHECK}?${query}` : URL_CHECK;
  const res = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as WebhookRouteCheckResponse | null;
}

/** Codici di errore del ripristino che hanno un testo proprio. */
const RESTORE_CODES = ["no_app_id", "no_app_secret", "wapi_gateway", "meta_rejected"] as const;
type RestoreCode = (typeof RESTORE_CODES)[number];

type RestoreState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done" }
  | { kind: "failed"; code: RestoreCode; message: string };

export function WebhookRouteAlert({ number }: { number: string }) {
  const { t, locale } = useT();
  const [data, setData] = useState<WebhookRouteCheckResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [restore, setRestore] = useState<RestoreState>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (refresh = false) => {
    setChecking(true);
    const d = await fetchCheck({ refresh, stats: true });
    if (d) setData(d);
    setNow(Date.now());
    setChecking(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRestore() {
    if (!window.confirm(t("settings.whatsapp.route.restoreConfirm"))) return;
    setRestore({ kind: "busy" });
    const res = await fetch(URL_RESTORE, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      setRestore({ kind: "done" });
      await load(true);
      return;
    }
    const body = (await res?.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    const code = RESTORE_CODES.find((c) => c === body?.error?.code) ?? "meta_rejected";
    setRestore({ kind: "failed", code, message: body?.error?.message || String(res?.status ?? "—") });
  }

  if (!data) return null;
  return (
    <WebhookRouteAlertView
      data={data}
      number={number}
      t={t}
      locale={locale}
      now={now}
      checking={checking}
      restore={restore}
      onCheckNow={() => void load(true)}
      onRestore={() => void onRestore()}
    />
  );
}

/** Vista pura (per i test): nessun fetch. */
export function WebhookRouteAlertView({
  data,
  number,
  t,
  locale,
  now,
  checking = false,
  restore = { kind: "idle" },
  onCheckNow,
  onRestore,
}: {
  data: WebhookRouteCheckResponse;
  number: string;
  t: TFunction;
  locale: Locale;
  now: number;
  checking?: boolean;
  restore?: RestoreState;
  onCheckNow: () => void;
  onRestore: () => void;
}) {
  const r = data.route;
  const k = (key: string, vars?: Record<string, string | number>) =>
    t(`settings.whatsapp.route.${key}`, vars);
  if (!r) return null;

  if (webhookRouteAlarming(r)) {
    const host = r.foreignHost ?? "—";
    const title =
      r.state === "override" ? k("overrideTitle") : r.state === "missing" ? k("missingTitle") : k("elsewhereTitle");
    const body =
      r.state === "override"
        ? k("overrideBody", { number, host, level: k(`level_${r.level}`) })
        : r.state === "missing"
          ? k("missingBody", { number })
          : r.sameHost
            ? k("sameHostBody", { number })
            : k("elsewhereBody", { number, host });
    // Il ripristino rimette il callback dell'APP: non toglie un override.
    const restorable = r.state !== "override";
    return (
      <div
        role="alert"
        data-testid="webhook-route-alert"
        data-route-state={r.state}
        className="space-y-3 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm"
      >
        <div className="flex items-start gap-2 text-danger-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">{title}</p>
            <p>{body}</p>
          </div>
        </div>
        {restorable &&
          (data.canRestore ? (
            <div className="space-y-2">
              {!r.sameHost && r.state === "elsewhere" && (
                <p className="text-xs text-danger-text">{k("restoreNote")}</p>
              )}
              <Button
                onClick={onRestore}
                disabled={restore.kind === "busy"}
                data-testid="webhook-route-restore"
              >
                {restore.kind === "busy" ? k("restoring") : k("restoreButton")}
              </Button>
              {restore.kind === "failed" && (
                <p className="text-xs text-danger-text" data-testid="webhook-route-restore-failed">
                  {restore.code === "meta_rejected"
                    ? k("restoreFailed", { message: restore.message })
                    : k(`restoreFailed_${restore.code}`)}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-danger-text">{k("askSuperadmin")}</p>
          ))}
        <CheckNow k={k} checking={checking} onCheckNow={onCheckNow} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {restore.kind === "done" && (
        <p role="status" className="text-sm font-medium text-success-text">
          {k("restored")}
        </p>
      )}
      {data.quiet && data.lastInboundAt && (
        <div
          data-testid="webhook-route-quiet"
          className="space-y-2 rounded-lg border border-warning-soft bg-warning-tint p-4 text-sm text-warning-text"
        >
          <p className="flex items-start gap-2 font-medium">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {k("quietTitle", { when: formatAgo(data.lastInboundAt, locale, now) })}
          </p>
          <p>{k("quietBody")}</p>
          <CheckNow k={k} checking={checking} onCheckNow={onCheckNow} />
        </div>
      )}
      {r.state === "ok" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="webhook-route-ok">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          {k("ok", { when: formatAgo(r.checkedAt, locale, now) })}
        </p>
      )}
    </div>
  );
}

function CheckNow({
  k,
  checking,
  onCheckNow,
}: {
  k: (key: string) => string;
  checking: boolean;
  onCheckNow: () => void;
}) {
  return (
    <Button variant="outline" size="sm" onClick={onCheckNow} disabled={checking}>
      <RefreshCw className={`mr-2 h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} aria-hidden="true" />
      {checking ? k("checking") : k("checkNow")}
    </Button>
  );
}

/** Barra in cima all'app (owner/admin) quando i messaggi non arrivano al CRM. */
export function WebhookRouteShellAlert() {
  const { t } = useT();
  const [alarm, setAlarm] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const d = await fetchCheck();
      if (alive && d) setAlarm(webhookRouteAlarming(d.route));
    };
    void run();
    const timer = window.setInterval(() => void run(), SHELL_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!alarm) return null;
  return (
    <div
      role="alert"
      data-testid="webhook-route-shell"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-danger-soft bg-danger-tint px-4 py-2 text-sm text-danger-text"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <span className="font-medium">{t("settings.whatsapp.route.shellTitle")}</span>
      <Link href="/settings/whatsapp" className="font-medium underline underline-offset-2">
        {t("settings.whatsapp.route.shellLink")}
      </Link>
    </div>
  );
}
