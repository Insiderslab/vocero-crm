import type { ChannelCapabilities } from "@/server/channels/types";

/**
 * 005-livello-canali (M1.3, T028) — Ventana de respuesta calculada desde las
 * capacidades del canal (ADR §3.1: `replyWindow`). WhatsApp = 24 h (`WINDOW_MS`,
 * que `src/server/inbox/window.ts` sigue exportando con la misma firma).
 *
 * Una conversación sin entrantes (p. ej. iniciada por plantilla) tiene la
 * ventana cerrada en un canal con ventana; un canal `unbounded` (email) no la
 * cierra nunca.
 */

type ReplyWindow = ChannelCapabilities["replyWindow"];

export function replyWindowOpen(
  window: ReplyWindow,
  lastInboundAt: Date | null,
  now: Date = new Date()
): boolean {
  if (window.kind === "unbounded") return true;
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < window.ms;
}

/** Milisegundos restantes (0 si está cerrada). `unbounded` → Infinity (contrato UI: M1.5). */
export function replyWindowRemainingMs(
  window: ReplyWindow,
  lastInboundAt: Date | null,
  now: Date = new Date()
): number {
  if (window.kind === "unbounded") return Number.POSITIVE_INFINITY;
  if (!lastInboundAt) return 0;
  const remaining = window.ms - (now.getTime() - lastInboundAt.getTime());
  return Math.max(0, remaining);
}
