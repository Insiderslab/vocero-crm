/** Utilidades de presentación de la bandeja. */

import type { TFunction } from "@/lib/i18n/client";
import type { ConversationDto } from "@/lib/types";
import { DEFAULT_LOCALE, intlLocale, type Locale } from "@/lib/i18n";

/** Hora (hoy) o día corto, en el idioma de la interfaz (009 E2). */
export function formatTime(iso: string | null, locale: Locale = DEFAULT_LOCALE): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(intlLocale(locale), {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short" });
}

/** Separador de día del hilo: «9 ottobre» / «October 9» / «9 de octubre». */
export function formatDay(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return new Date(iso).toLocaleDateString(intlLocale(locale), {
    day: "numeric",
    month: "long",
  });
}

/** Hora de una burbuja (24 h). */
export function formatBubbleTime(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return new Date(iso).toLocaleTimeString(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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

/**
 * ¿La conversación espera a una persona? Handoff activo, salvo que sea el
 * provisional de un segundo intento del agente todavía pendiente.
 */
export function needsHuman(c: Pick<ConversationDto, "handoffAt" | "agentRetryAt">): boolean {
  return Boolean(c.handoffAt) && !c.agentRetryAt;
}

/** 009 (E1): el agente reintentará solo (`agent_retry_at`). */
export function retryPending(c: Pick<ConversationDto, "agentRetryAt">): boolean {
  return Boolean(c.agentRetryAt);
}

export function matchesInboxFilter(
  c: Pick<ConversationDto, "handoffAt" | "agentRetryAt" | "unreadCount">,
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
export function sortHandoffFirst<T extends Pick<ConversationDto, "handoffAt" | "agentRetryAt">>(
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
