import { apiError } from "@/lib/api";

/**
 * 005 (R2) — 409 claro cuando la copia estricta en `channel_account` rechaza
 * el guardado de la conexión (`ChannelMirrorError`): no se cambió nada y el
 * motivo ya está en el log del servidor (sin valores).
 */
export function channelMirrorConflict(): Response {
  return apiError(
    409,
    "channel_account_conflict",
    "No se pudo guardar la conexión: este número sigue asociado a otra cuenta del CRM. No se cambió nada; pide ayuda al administrador de la instancia."
  );
}
