import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 010 — gráficos de la página «Sintesi»: CSS a mano (sin librerías, la
 * constitución prohíbe dependencias nuevas). Componentes puros: reciben los
 * textos ya traducidos, así que no dependen del idioma y son testeables con
 * `renderToStaticMarkup`.
 *
 * Accesibilidad: cada gráfico lleva `aria-label` con los números (texto
 * alternativo), las barras van `aria-hidden` y el gráfico de días repite cada
 * punto en una lista `sr-only` (fuera del `role="img"`, que la silenciaría). Colores del tema (claro/oscuro) y a 390 px las
 * barras usan todo el ancho disponible.
 */

export function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border bg-card p-4", className)}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function EmptyNote({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

export function StatNumber({
  label,
  value,
  big = false,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <div>
      <p className={cn("font-semibold tabular-nums", big ? "text-3xl" : "text-2xl")}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function SkeletonBlock() {
  return <div aria-hidden="true" className="h-28 animate-pulse rounded-lg bg-accent" />;
}

/** Barras horizontales: conversaciones por etapa. */
export function StageChart({
  rows,
  empty,
  aria,
  formatValue,
}: {
  rows: { name: string; value: number }[];
  empty: string;
  aria: string;
  formatValue: (n: number) => string;
}) {
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  if (total === 0) return <EmptyNote text={empty} />;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div role="img" aria-label={aria}>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.name}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{r.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatValue(r.value)}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-accent" aria-hidden="true">
              <div
                className="h-full rounded-full bg-brand"
                style={{
                  width: r.value === 0 ? "0%" : `${Math.max((r.value / max) * 100, 4)}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type DailyPoint = { date: string; inbound: number; outbound: number };

/**
 * Serie CONTINUA de días (UTC, `YYYY-MM-DD`) entre `from` y `to`: la consulta
 * solo devuelve los días con mensajes y, sin rellenar, dos barras de días
 * lejanos saldrían pegadas. Los días sin datos van en 0; un punto fuera del
 * rango (reloj del navegador desfasado) amplía el rango en vez de perderse.
 */
export function fillDailyGaps(
  points: DailyPoint[],
  from: string,
  to: string
): DailyPoint[] {
  const byDate = new Map(points.map((p) => [p.date, p]));
  const dates = [from, to, ...points.map((p) => p.date)].sort();
  const start = Date.parse(`${dates[0]}T00:00:00Z`);
  const end = Date.parse(`${dates[dates.length - 1]}T00:00:00Z`);
  const out: DailyPoint[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push(byDate.get(date) ?? { date, inbound: 0, outbound: 0 });
  }
  return out;
}

/** Barras verticales: entrantes y salientes por día. */
export function DailyChart({
  points,
  empty,
  aria,
  inboundLabel,
  outboundLabel,
  formatDay,
  formatNumber,
}: {
  points: DailyPoint[];
  empty: string;
  aria: string;
  inboundLabel: string;
  outboundLabel: string;
  formatDay: (iso: string) => string;
  formatNumber: (n: number) => string;
}) {
  if (points.every((p) => p.inbound === 0 && p.outbound === 0)) {
    return <EmptyNote text={empty} />;
  }
  const max = Math.max(...points.flatMap((p) => [p.inbound, p.outbound]), 1);
  const height = (value: number) =>
    value === 0 ? "0%" : `${Math.max(Math.round((value / max) * 100), 4)}%`;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return (
    <div>
      {/* El `role="img"` envuelve SOLO las barras: dentro de un img los hijos
          son presentacionales y la lista sr-only de abajo quedaría muda. */}
      <div role="img" aria-label={aria}>
        <ul aria-hidden="true" className="flex h-24 items-end gap-[2px]">
          {points.map((p) => (
            <li
              key={p.date}
              className="flex h-full min-w-0 flex-1 items-end justify-center gap-[1px]"
            >
              <span className="block w-1/2 rounded-t-[2px] bg-brand" style={{ height: height(p.inbound) }} />
              <span
                className="block w-1/2 rounded-t-[2px] bg-border-strong"
                style={{ height: height(p.outbound) }}
              />
            </li>
          ))}
        </ul>
      </div>
      <ul className="sr-only">
        {points
          .filter((p) => p.inbound > 0 || p.outbound > 0)
          .map((p) => (
            <li key={p.date}>
              {formatDay(p.date)}: {inboundLabel} {formatNumber(p.inbound)}, {outboundLabel}{" "}
              {formatNumber(p.outbound)}
            </li>
          ))}
      </ul>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-text-3">
        <span>{formatDay(first.date)}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-brand" />
            {inboundLabel}
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-border-strong" />
            {outboundLabel}
          </span>
        </span>
        <span>{formatDay(last.date)}</span>
      </div>
    </div>
  );
}

/** Barra apilada: proporción IA contra persona en los salientes. */
export function QuotaBar({
  ai,
  human,
  aiLabel,
  humanLabel,
  aria,
  formatNumber,
}: {
  ai: number;
  human: number;
  aiLabel: string;
  humanLabel: string;
  aria: string;
  formatNumber: (n: number) => string;
}) {
  const total = ai + human;
  const aiPct = total === 0 ? 0 : (ai / total) * 100;
  return (
    <div>
      <div role="img" aria-label={aria} className="flex h-3 overflow-hidden rounded-full bg-accent">
        <div className="bg-brand" style={{ width: `${aiPct}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
        <span>
          <strong className="tabular-nums">{formatNumber(ai)}</strong> {aiLabel}
        </span>
        <span>
          <strong className="tabular-nums">{formatNumber(human)}</strong> {humanLabel}
        </span>
      </div>
    </div>
  );
}

/** Lista de handoffs por motivo (ya traducidos por quien la usa). */
export function HandoffList({
  rows,
  empty,
  formatValue,
}: {
  rows: { key: string; label: string; value: number }[];
  empty: string;
  formatValue: (n: number) => string;
}) {
  if (rows.length === 0) return <EmptyNote text={empty} />;
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-3">
          <span className="truncate">{r.label}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {formatValue(r.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}
