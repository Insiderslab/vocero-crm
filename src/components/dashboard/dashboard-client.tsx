"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { DashboardSummary, SummaryDays } from "@/server/dashboard/summary";
import { stageLabel } from "@/lib/stages";
import {
  DailyChart,
  EmptyNote,
  fillDailyGaps,
  HandoffList,
  QuotaBar,
  Section,
  SkeletonBlock,
  StageChart,
  StatNumber,
} from "@/components/dashboard/charts";

/**
 * 010 — «Sintesi» (dashboard). El estado vive del lado cliente solo por el
 * selector de período: cada cambio pide `/api/dashboard/summary` y, mientras
 * llega, se muestran esqueletos — jamás un falso cero. Una respuesta vieja no
 * pisa a una nueva (la petición en curso se invalida al cambiar de período).
 */

const PERIODS: readonly SummaryDays[] = [7, 30, 90];
const SKELETON_COUNT = 5;

export function DashboardClient() {
  const { locale, t } = useT();
  const [days, setDays] = useState<SummaryDays>(30);
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setData(null);
    setFailed(false);
    void (async () => {
      const res = await fetch(`/api/dashboard/summary?days=${days}`).catch(() => null);
      if (!active) return;
      if (!res?.ok) {
        setFailed(true);
        return;
      }
      setData((await res.json()) as DashboardSummary);
    })();
    return () => {
      active = false;
    };
  }, [days, reloadKey]);

  const numberFormat = new Intl.NumberFormat(locale);
  const formatNumber = (n: number) => numberFormat.format(n);
  const dayFormat = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
  const formatDay = (iso: string) => dayFormat.format(new Date(`${iso}T00:00:00Z`));

  // Andamento continuo: del primer día UTC del período a hoy (UTC), con ceros.
  const today = new Date();
  const daily = data
    ? fillDailyGaps(
        data.daily,
        new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10),
        today.toISOString().slice(0, 10)
      )
    : [];

  const totalInbound = data?.daily.reduce((sum, p) => sum + p.inbound, 0) ?? 0;
  const totalOutbound = data?.daily.reduce((sum, p) => sum + p.outbound, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div role="group" aria-label={t("dashboard.period")} className="inline-flex flex-wrap gap-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={days === p}
            onClick={() => setDays(p)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              days === p
                ? "bg-brand-tint font-semibold text-brand-text"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            {t("dashboard.periodDays", { days: p })}
          </button>
        ))}
      </div>

      {failed ? (
        <p className="text-sm text-destructive">
          {t("dashboard.error")}{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            {t("dashboard.retry")}
          </button>
        </p>
      ) : data === null ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <SkeletonBlock key={i} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t("dashboard.stages.title")}>
            <StageChart
              // 009 (E2): las etapas de fábrica, en el idioma de la interfaz.
              rows={data.stages.map((s) => ({ name: stageLabel(s.name, locale), value: s.conversations }))}
              empty={t("dashboard.stages.empty")}
              aria={t("dashboard.stages.aria", {
                items: data.stages
                  .map((s) => `${stageLabel(s.name, locale)}: ${formatNumber(s.conversations)}`)
                  .join(", "),
              })}
              formatValue={formatNumber}
            />
          </Section>

          <Section title={t("dashboard.firstResponse.title")}>
            {data.firstResponse.answered === 0 ? (
              <EmptyNote text={t("dashboard.firstResponse.empty")} />
            ) : (
              <div
                role="img"
                aria-label={t("dashboard.firstResponse.aria", {
                  median: formatNumber(data.firstResponse.medianMinutes ?? 0),
                  p90: formatNumber(data.firstResponse.p90Minutes ?? 0),
                  answered: formatNumber(data.firstResponse.answered),
                })}
                className="flex flex-wrap items-end gap-6"
              >
                <StatNumber
                  label={t("dashboard.firstResponse.median")}
                  value={t("dashboard.firstResponse.minutes", {
                    value: formatNumber(data.firstResponse.medianMinutes ?? 0),
                  })}
                />
                <StatNumber
                  label={t("dashboard.firstResponse.p90")}
                  value={t("dashboard.firstResponse.minutes", {
                    value: formatNumber(data.firstResponse.p90Minutes ?? 0),
                  })}
                />
                <p className="text-xs text-muted-foreground">
                  {t("dashboard.firstResponse.answered", {
                    count: formatNumber(data.firstResponse.answered),
                  })}
                </p>
              </div>
            )}
          </Section>

          <Section title={t("dashboard.outgoing.title")}>
            {data.outgoing.ai + data.outgoing.human === 0 ? (
              <EmptyNote text={t("dashboard.outgoing.empty")} />
            ) : (
              <QuotaBar
                ai={data.outgoing.ai}
                human={data.outgoing.human}
                aiLabel={t("dashboard.outgoing.ai")}
                humanLabel={t("dashboard.outgoing.human")}
                aria={t("dashboard.outgoing.aria", {
                  ai: formatNumber(data.outgoing.ai),
                  human: formatNumber(data.outgoing.human),
                })}
                formatNumber={formatNumber}
              />
            )}
            <h4 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("dashboard.outgoing.handoffsTitle")}
            </h4>
            <div className="mt-2">
              <HandoffList
                rows={data.handoffs.map((h) => ({
                  key: h.reason ?? "unknown",
                  label: h.reason
                    ? t(`dashboard.outgoing.reason.${h.reason}`)
                    : t("dashboard.outgoing.unknownReason"),
                  value: h.conversations,
                }))}
                empty={t("dashboard.outgoing.handoffEmpty")}
                formatValue={formatNumber}
              />
            </div>
          </Section>

          <Section title={t("dashboard.conversions.title")}>
            {data.conversions.won === 0 ? (
              <EmptyNote text={t("dashboard.conversions.empty")} />
            ) : (
              <StatNumber
                label={t("dashboard.conversions.won")}
                value={formatNumber(data.conversions.won)}
                big
              />
            )}
          </Section>

          <Section title={t("dashboard.trend.title")} className="lg:col-span-2">
            <DailyChart
              points={daily}
              empty={t("dashboard.trend.empty")}
              aria={t("dashboard.trend.aria", {
                inbound: formatNumber(totalInbound),
                outbound: formatNumber(totalOutbound),
              })}
              inboundLabel={t("dashboard.trend.inbound")}
              outboundLabel={t("dashboard.trend.outbound")}
              formatDay={formatDay}
              formatNumber={formatNumber}
            />
          </Section>
        </div>
      )}
    </div>
  );
}
