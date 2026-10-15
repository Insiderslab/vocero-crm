import { whatsappCapabilities, WHATSAPP_WINDOW_MS } from "@/server/channels/whatsapp/capabilities";
import { replyWindowOpen, replyWindowRemainingMs } from "@/server/channels/core/window";

/**
 * Ventana de servicio de 24 horas de WhatsApp: solo se puede enviar texto
 * libre dentro de las 24h siguientes al último mensaje ENTRANTE. Una
 * conversación sin entrantes (p. ej. iniciada por plantilla) tiene la
 * ventana cerrada.
 *
 * 005 (M1.3): módulo delgado. La constante es la capacidad `replyWindow` de
 * WhatsApp y el cálculo está en el núcleo (`channels/core/window.ts`). Mismas
 * firmas: los consumidores (envío, agente, bandeja, automatizaciones, API del
 * bot) pasan a leer la ventana del canal de la conversación en M1.5.
 */

export const WINDOW_MS = WHATSAPP_WINDOW_MS;

export function isWindowOpen(
  lastInboundAt: Date | null,
  now: Date = new Date()
): boolean {
  return replyWindowOpen(whatsappCapabilities.replyWindow, lastInboundAt, now);
}

/** Milisegundos restantes de ventana (0 si está cerrada). */
export function windowRemainingMs(
  lastInboundAt: Date | null,
  now: Date = new Date()
): number {
  return replyWindowRemainingMs(whatsappCapabilities.replyWindow, lastInboundAt, now);
}
