/** Utilidades de presentación de la bandeja. */

import type { TFunction } from "@/lib/i18n/client";
import type { ConversationDto } from "@/lib/types";

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function formatRemaining(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const MEDIA_KEYS = new Set([
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
  "template",
]);

export function mediaLabel(type: string, t: TFunction): string {
  return MEDIA_KEYS.has(type) ? t(`inbox.media.${type}`) : t("inbox.media.other");
}

/** 008 — Tamaño humano de un adjunto. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function previewText(preview: string | null, t: TFunction): string {
  if (!preview) return "";
  return MEDIA_KEYS.has(preview) ? `📎 ${mediaLabel(preview, t)}` : preview;
}

/* ----------------------- 009 (E1c): asistencia humana ----------------------- */

/** Filtros rápidos de la bandeja. */
export type InboxFilter = "all" | "unread" | "handoff";

/** ¿La conversación espera a una persona? (handoff activo). */
export function needsHuman(c: Pick<ConversationDto, "handoffAt">): boolean {
  return Boolean(c.handoffAt);
}

export function matchesInboxFilter(
  c: Pick<ConversationDto, "handoffAt" | "unreadCount">,
  filter: InboxFilter
): boolean {
  if (filter === "unread") return c.unreadCount > 0;
  if (filter === "handoff") return needsHuman(c);
  return true;
}

/**
 * Lo que espera a una persona va arriba. Orden ESTABLE: dentro de cada grupo
 * se conserva el orden del servidor (lo más reciente primero), así la lista no
 * baila con cada evento.
 */
export function sortHandoffFirst<T extends Pick<ConversationDto, "handoffAt">>(
  list: readonly T[]
): T[] {
  return [...list.filter(needsHuman), ...list.filter((c) => !needsHuman(c))];
}

/** Motivos de handoff con etiqueta propia (`inbox.handoffReasons.*`). */
export const HANDOFF_REASON_KEYS = [
  "cliente",
  "modelo",
  "error",
  "ventana",
  "manual_reply",
  "hostilidad",
] as const;

/** Etiqueta corta del motivo; sin motivo conocido, "Asistencia humana". */
export function handoffLabel(reason: string | null | undefined, t: TFunction): string {
  return (HANDOFF_REASON_KEYS as readonly string[]).includes(reason ?? "")
    ? t(`inbox.handoffReasons.${reason}`)
    : t("inbox.handoff");
}
