"use client";

import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * 009 (E3) — Esqueletos de carga. Mientras los datos viajan, la pantalla
 * enseña la FORMA de lo que viene —nunca un "Nessun contatto" que es mentira
 * hasta que llega la respuesta—. Lleva `role="status"` y un texto para
 * lectores de pantalla; las barras son decorativas.
 */

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={style}
      className={cn("block animate-pulse rounded-md bg-secondary", className)}
    />
  );
}

/** Contenedor accesible de un esqueleto: anuncia "Cargando…" una vez. */
export function LoadingRegion({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useT();
  return (
    <div role="status" aria-busy="true" data-loading="" className={className}>
      <span className="sr-only">{t("common.loading")}</span>
      {children}
    </div>
  );
}

/** Filas con avatar (bandeja, contactos). */
export function ListSkeleton({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <LoadingRegion className={cn("space-y-1", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}

/** Columnas del tablero del pipeline. */
export function BoardSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <LoadingRegion className="flex h-full gap-3">
      {Array.from({ length: columns }, (_, i) => (
        <div key={i} className="flex h-full w-64 shrink-0 flex-col gap-2 rounded-lg border bg-card/50 p-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </LoadingRegion>
  );
}

/** Tarjetas (agente, laboratorio, automatizaciones). */
export function CardsSkeleton({ cards = 2, className }: { cards?: number; className?: string }) {
  return (
    <LoadingRegion className={cn("grid gap-4", className)}>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="space-y-3 rounded-lg border bg-card p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </LoadingRegion>
  );
}
