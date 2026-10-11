"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, UserRound, X } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { handoffLabel } from "@/components/inbox/helpers";
import { useEvents, type HandoffAlert } from "@/components/use-events";

/** Cuánto se queda un aviso en pantalla si nadie lo cierra. */
const ALERT_TTL_MS = 15_000;
/** Más de tres a la vez taparía la pantalla: se quedan los más nuevos. */
const MAX_ALERTS = 3;

/**
 * Lista de avisos: uno por conversación (un segundo handoff de la misma
 * conversación reemplaza al anterior y queda arriba). Pura para probarla.
 */
export function pushAlert(list: HandoffAlert[], alert: HandoffAlert): HandoffAlert[] {
  return [alert, ...list.filter((a) => a.conversationId !== alert.conversationId)].slice(
    0,
    MAX_ALERTS
  );
}

/**
 * 009 (E1d) — Aviso en la app cuando una conversación pasa a una persona.
 * Vive en el cascarón, así se ve en cualquier pantalla. Es la ÚNICA alerta:
 * nada de email, Slack ni push (Constitución II).
 */
export function HandoffAlerts() {
  const { t } = useT();
  const [alerts, setAlerts] = useState<HandoffAlert[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((conversationId: string) => {
    setAlerts((prev) => prev.filter((a) => a.conversationId !== conversationId));
    const timer = timers.current.get(conversationId);
    if (timer) clearTimeout(timer);
    timers.current.delete(conversationId);
  }, []);

  useEvents({
    onHandoff: (alert) => {
      if (!alert?.conversationId) return;
      setAlerts((prev) => pushAlert(prev, alert));
      const old = timers.current.get(alert.conversationId);
      if (old) clearTimeout(old);
      timers.current.set(
        alert.conversationId,
        setTimeout(() => dismiss(alert.conversationId), ALERT_TTL_MS)
      );
    },
  });

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  return (
    <div
      role="region"
      aria-label={t("inbox.alert.region")}
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
    >
      {alerts.map((a) => {
        const isError = a.reason === "error";
        const Icon = isError ? AlertTriangle : UserRound;
        return (
          <div
            key={a.conversationId}
            role="status"
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-background p-3 shadow-pop",
              isError ? "border-danger-soft" : "border-warning-soft"
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                isError ? "text-danger-text" : "text-warning-text"
              )}
              strokeWidth={1.8}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-snug">
                {t("inbox.alert.title", {
                  name: a.contactName ?? t("inbox.alert.someone"),
                })}
              </p>
              <p className="mt-0.5 text-xs text-text-2">{handoffLabel(a.reason, t)}</p>
              <Link
                href={`/inbox?conversation=${encodeURIComponent(a.conversationId)}`}
                onClick={() => dismiss(a.conversationId)}
                className="mt-1.5 inline-block text-xs font-medium text-brand-text underline underline-offset-2 hover:text-brand"
              >
                {t("inbox.alert.open")}
              </Link>
            </div>
            <button
              type="button"
              onClick={() => dismiss(a.conversationId)}
              aria-label={t("inbox.alert.dismiss")}
              className="shrink-0 rounded p-0.5 text-text-3 hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
