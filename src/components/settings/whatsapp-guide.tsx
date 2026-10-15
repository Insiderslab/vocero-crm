"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  Info,
  KeyRound,
  Lock,
  MessageCircle,
  Phone,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useT, type TFunction } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n";
import {
  connectionMode,
  guideState,
  reconnectVia,
  guideSteps,
  signatureState,
  type GuideState,
  type StepStatus,
} from "@/lib/whatsapp-guide";
import type { WhatsappGuideStatus } from "@/server/whatsapp/guide-status";
import { Button } from "@/components/ui/button";
import { CoexistenceConnect } from "@/components/settings/coexistence-connect";
import { WhatsappAdvanced } from "@/components/settings/whatsapp-advanced";
import { WapiKeyCard } from "@/components/settings/wapi-key-card";
import { formatAgo } from "@/components/settings/webhook-signature-status";
import { useEvents } from "@/components/use-events";

/**
 * 013 — Configurazione → WhatsApp in modalità guidata (owner/admin).
 *
 * In alto la striscia di stato (numero, modalità, firma del webhook, ultimo
 * messaggio); poi tre passi: (1) collega il numero con Meta, (2) conferma sul
 * telefono, (3) prova scrivendo da un altro telefono. Tutto il tecnico
 * (WABA, token, webhook, override, chiave Wapi) sta in «Avanzate», chiusa.
 * Lo stato si calcola con la macchina pura di `@/lib/whatsapp-guide`.
 */

export const ADVANCED_HASH = "#avanzate";

export function WhatsappGuide() {
  const { t, locale } = useT();
  const [status, setStatus] = useState<WhatsappGuideStatus | "loading" | "error">("loading");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Rimonta «Avanzate» dopo un collegamento con Meta: il modulo manuale mostra i dati nuovi.
  const [advancedKey, setAdvancedKey] = useState(0);
  const [syncOk, setSyncOk] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/whatsapp/status", { cache: "no-store" }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as WhatsappGuideStatus | null) : null;
    setStatus((prev) => data ?? (prev === "loading" ? "error" : prev));
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void refetch();
    if (window.location.hash === ADVANCED_HASH) setAdvancedOpen(true);
    // «X minuti fa» resta vero senza ricaricare.
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [refetch]);

  // Passo 3 in diretta: ogni messaggio nuovo (SSE) aggiorna «ultimo messaggio ricevuto».
  useEvents({ onMessageNew: () => void refetch(), onReconnect: () => void refetch() });

  function openAdvanced(focus?: "token") {
    setAdvancedOpen(true);
    window.requestAnimationFrame(() => {
      const target = focus ? document.getElementById(focus) : null;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.focus({ preventScroll: true });
      } else {
        document.getElementById("avanzate")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  return (
    <div className="space-y-6">
      {status === "loading" ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {t("settings.whatsapp.guide.loadError")}
        </p>
      ) : (
        <WhatsappGuideView
          status={status}
          t={t}
          locale={locale}
          now={now}
          syncOk={syncOk}
          onOpenAdvanced={openAdvanced}
          renderConnect={(label) => (
            <CoexistenceConnect
              label={label}
              onConnected={(r) => {
                setSyncOk(r.syncOk);
                setAdvancedKey((k) => k + 1);
                void refetch();
              }}
            />
          )}
        />
      )}

      <details
        id="avanzate"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
        className="rounded-lg border bg-card"
      >
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
          {t("settings.whatsapp.guide.advanced")}
          <span className="block text-xs font-normal text-muted-foreground">
            {t("settings.whatsapp.guide.advancedHint")}
          </span>
        </summary>
        <div className="space-y-6 border-t p-4">
          <WhatsappAdvanced key={advancedKey} onSaved={() => void refetch()} />
          <WapiKeyCard />
        </div>
      </details>
    </div>
  );
}

/* --------------------------- vista (senza fetch) --------------------------- */

export function WhatsappGuideView({
  status,
  t,
  locale,
  now,
  syncOk = null,
  onOpenAdvanced,
  renderConnect,
}: {
  status: WhatsappGuideStatus;
  t: TFunction;
  locale: Locale;
  now: number;
  /** Esito della richiesta di rubrica e storico dopo «Collega con Meta» (null = non appena fatto). */
  syncOk?: boolean | null;
  /** Apre «Avanzate»; con "token" mette il cursore sul campo del token. */
  onOpenAdvanced: (focus?: "token") => void;
  /** Il pulsante «Collega con Meta» (iniettato: nei test basta un segnaposto). */
  renderConnect: (label?: string) => ReactNode;
}) {
  const state = guideState({ platformReady: status.platform.ready, connection: status.connection });
  const steps = guideSteps(state, status.lastInboundAt);
  const via = reconnectVia({ platformReady: status.platform.ready, connection: status.connection });
  const g = (key: string, vars?: Record<string, string | number>) =>
    t(`settings.whatsapp.guide.${key}`, vars);
  const number = status.connection
    ? (status.connection.displayPhoneNumber ?? status.connection.phoneNumberId)
    : null;

  const advancedLink = (key: string) => (
    <button
      type="button"
      onClick={() => onOpenAdvanced()}
      className="font-medium text-brand-text underline-offset-2 hover:underline"
    >
      {g(key)}
    </button>
  );

  return (
    <div className="space-y-6" data-guide-state={state}>
      <StatusStrip status={status} t={t} locale={locale} now={now} />

      <StateBanner
        state={state}
        status={status}
        via={via}
        onOpenToken={() => onOpenAdvanced("token")}
        t={t}
        g={g}
        renderConnect={renderConnect}
        advancedLink={advancedLink}
      />

      <section aria-labelledby="wa-guide-title" className="rounded-lg border bg-card p-4 sm:p-5">
        <h3 id="wa-guide-title" className="text-base font-semibold">
          {g("title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{g("intro")}</p>

        <ol className="mt-4 space-y-3">
          <Step n={1} status={steps.connect} title={g("steps.connect.title")} g={g}>
            {state === "connected" ? (
              <p className="text-sm">{g("steps.connect.done", { number: number ?? "" })}</p>
            ) : state === "not_configured" ? (
              // El título ya está en el aviso de arriba: aquí solo qué pasa y la salida manual.
              <p className="text-sm text-muted-foreground">
                {status.platform.reason === "wapi_gateway"
                  ? g("notConfigured.wapi")
                  : g("notConfigured.body")}{" "}
                {advancedLink("notConfigured.manual")}
              </p>
            ) : state === "ready" ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{g("steps.connect.body")}</p>
                {renderConnect()}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {g(via === "meta" ? "steps.connect.reconnectHint" : "steps.connect.reconnectManualHint")}
              </p>
            )}
          </Step>

          <Step n={2} status={steps.confirm} title={g("steps.confirm.title")} g={g}>
            <p className="text-sm text-muted-foreground">{g("steps.confirm.body")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.whatsapp.coexPoint2")}</p>
            {steps.confirm === "done" && syncOk !== null && (
              <p className="mt-1 text-sm">
                {syncOk
                  ? t("settings.whatsapp.coexSyncRequested")
                  : t("settings.whatsapp.coexSyncFailed")}
              </p>
            )}
          </Step>

          <Step n={3} status={steps.test} title={g("steps.test.title")} g={g}>
            <p className="text-sm text-muted-foreground">{g("steps.test.body")}</p>
            {state === "connected" && (
              <p
                className="mt-2 flex items-center gap-2 text-sm"
                aria-live="polite"
                data-testid="guide-last-inbound"
              >
                {status.lastInboundAt ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                    <span>
                      {g("steps.test.received", { when: formatAgo(status.lastInboundAt, locale, now) })}{" "}
                      <Link
                        href="/inbox"
                        className="font-medium text-brand-text underline-offset-2 hover:underline"
                      >
                        {g("steps.test.openInbox")}
                      </Link>
                    </span>
                  </>
                ) : (
                  <>
                    <Clock className="h-4 w-4 text-text-3" aria-hidden="true" />
                    {g("steps.test.waiting")}
                  </>
                )}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">{t("settings.whatsapp.coexPoint3")}</p>
          </Step>
        </ol>
      </section>
    </div>
  );
}

function StatusStrip({
  status,
  t,
  locale,
  now,
}: {
  status: WhatsappGuideStatus;
  t: TFunction;
  locale: Locale;
  now: number;
}) {
  const g = (key: string, vars?: Record<string, string | number>) =>
    t(`settings.whatsapp.guide.status.${key}`, vars);
  const c = status.connection;
  const sig = signatureState(status.signature);
  const mode = c ? connectionMode(c.onboardingMode) : null;

  // Senza numero la firma (dato dell'istanza) non dice nulla a questa azienda:
  // «—». Il valore d'istanza resta nella scheda di /admin.
  const sigText = !c
    ? "—"
    : sig === "verified"
      ? g("sigVerified", { when: formatAgo(status.signature.stats.lastVerifiedAt!, locale, now) })
      : g(`sig_${sig}`);
  const sigTone = !c ? "muted" : sig === "verified" ? "ok" : sig === "waiting" || sig === "test_mode" ? "muted" : "warn";

  return (
    <dl
      aria-label={g("label")}
      className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4"
    >
      <StripItem icon={<Phone className="h-4 w-4" />} label={g("number")} tone={c ? "ok" : "muted"}>
        {c ? (
          <>
            <span className="block truncate">{c.displayPhoneNumber ?? c.phoneNumberId}</span>
            {c.verifiedName && (
              <span className="block truncate text-xs text-muted-foreground">{c.verifiedName}</span>
            )}
          </>
        ) : (
          g("numberNone")
        )}
      </StripItem>
      <StripItem icon={<Smartphone className="h-4 w-4" />} label={g("mode")} tone={mode ? "ok" : "muted"}>
        {mode ? g(`mode_${mode}`) : "—"}
        {mode === "coexistence" && (
          <span className="block text-xs text-muted-foreground">
            {t("settings.whatsapp.coexKeepAlive")}
          </span>
        )}
      </StripItem>
      <StripItem icon={<ShieldCheck className="h-4 w-4" />} label={g("signature")} tone={sigTone}>
        <span data-testid="guide-signature">{sigText}</span>
      </StripItem>
      <StripItem icon={<MessageCircle className="h-4 w-4" />} label={g("lastInbound")} tone={status.lastInboundAt ? "ok" : "muted"}>
        {status.lastInboundAt ? formatAgo(status.lastInboundAt, locale, now) : g("lastInboundNone")}
      </StripItem>
    </dl>
  );
}

function StripItem({
  icon,
  label,
  tone,
  children,
}: {
  icon: ReactNode;
  label: string;
  tone: "ok" | "warn" | "muted";
  children: ReactNode;
}) {
  const iconColor = tone === "ok" ? "text-success" : tone === "warn" ? "text-warning-text" : "text-text-3";
  return (
    <div className="min-w-0 bg-card p-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={iconColor} aria-hidden="true">
          {icon}
        </span>
        {label}
      </dt>
      <dd className={`mt-1 text-sm font-medium ${tone === "warn" ? "text-warning-text" : ""}`}>{children}</dd>
    </div>
  );
}

function StateBanner({
  state,
  status,
  via,
  onOpenToken,
  t,
  g,
  renderConnect,
  advancedLink,
}: {
  state: GuideState;
  status: WhatsappGuideStatus;
  via: "meta" | "manual" | null;
  onOpenToken: () => void;
  t: TFunction;
  g: (key: string, vars?: Record<string, string | number>) => string;
  renderConnect: (label?: string) => ReactNode;
  advancedLink: (key: string) => ReactNode;
}) {
  if (state === "connected") {
    const number = status.connection?.displayPhoneNumber ?? status.connection?.phoneNumberId ?? "";
    return (
      <div className="flex items-start gap-2 rounded-lg border border-success-soft bg-success-tint p-4 text-sm">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        <p className="font-medium text-success-text">{g("banner.connected", { number })}</p>
      </div>
    );
  }
  if (state === "ready") {
    return (
      <div className="flex items-start gap-2 rounded-lg border bg-subtle p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" aria-hidden="true" />
        <p>{g("banner.ready")}</p>
      </div>
    );
  }
  if (state === "not_configured") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-warning-soft bg-warning-tint p-4 text-sm text-warning-text">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="font-medium">{g("notConfigured.title")}</p>
      </div>
    );
  }
  // reconnect_required / app_disconnected: rosso, con il rimedio a portata di mano.
  const disconnected = state === "app_disconnected";
  return (
    <div
      role="alert"
      className="space-y-3 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="text-danger-text">
          <p className="font-medium">
            {disconnected
              ? t("settings.whatsapp.disconnectedTitle")
              : t("settings.whatsapp.reconnectTitle")}
          </p>
          <p>
            {disconnected
              ? t("settings.whatsapp.disconnectedBody")
              : t("settings.whatsapp.reconnectBody")}
          </p>
        </div>
      </div>
      {via === "meta" ? (
        <div className="space-y-2">
          {renderConnect(g("banner.reconnectButton"))}
          <p className="text-xs text-danger-text">{advancedLink("banner.manualAlternative")}</p>
        </div>
      ) : (
        // Connessione non in coexistence (o piattaforma non pronta): solo token
        // nuovo. Mai il pulsante di Meta, che cambierebbe la modalità del numero.
        <div className="space-y-2" data-reconnect="manual">
          {status.connection?.onboardingMode !== "coexistence" && (
            <p className="text-danger-text">{g("banner.manualReconnectBody")}</p>
          )}
          <Button variant="outline" onClick={onOpenToken}>
            <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
            {g("banner.manualReconnectButton")}
          </Button>
        </div>
      )}
    </div>
  );
}

const STEP_ICON: Record<StepStatus, ReactNode> = {
  done: <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />,
  current: <CircleDot className="h-5 w-5 text-brand-text" aria-hidden="true" />,
  todo: <Circle className="h-5 w-5 text-text-3" aria-hidden="true" />,
  blocked: <Lock className="h-5 w-5 text-text-3" aria-hidden="true" />,
};

function Step({
  n,
  status,
  title,
  g,
  children,
}: {
  n: number;
  status: StepStatus;
  title: string;
  g: (key: string) => string;
  children: ReactNode;
}) {
  return (
    <li
      data-step-status={status}
      aria-current={status === "current" ? "step" : undefined}
      className={`flex gap-3 rounded-md border p-3 ${status === "current" ? "border-brand bg-brand-tint" : ""}`}
    >
      <span className="mt-0.5 shrink-0">{STEP_ICON[status]}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
          <span>
            {n}. {title}
          </span>
          <span className="text-xs font-normal text-muted-foreground">{g(`stepState.${status}`)}</span>
        </p>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  );
}
