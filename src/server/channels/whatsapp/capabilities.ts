import type { ChannelCapabilities } from "@/server/channels/types";

/**
 * 005-livello-canali (M1.3, T027) — Capacità di WhatsApp Cloud API.
 *
 * Riproducono le costanti di oggi (FR-014): la finestra di 24 ore (prima in
 * `src/server/inbox/window.ts`, che ora la re-esporta come `WINDOW_MS`) e i
 * limiti per tipo di allegato (prima in `src/server/whatsapp/media.ts`, che
 * re-esporta `MEDIA_LIMITS`). Sono la fonte: nessun altro file li ridefinisce.
 */

/**
 * Ventana de servicio de 24 horas de WhatsApp: solo se puede enviar texto
 * libre dentro de las 24h siguientes al último mensaje ENTRANTE.
 */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Límites de la Cloud API por tipo (validados ANTES de tocar red, FR-007). */
export const MEDIA_LIMITS: Record<
  "image" | "sticker" | "audio" | "video" | "document",
  { maxBytes: number; mimes: RegExp; label: string }
> = {
  image: {
    maxBytes: 5 * 1024 * 1024,
    mimes: /^image\/(jpeg|png|webp)$/,
    label: "imagen (jpeg/png/webp, máx. 5 MB)",
  },
  sticker: {
    maxBytes: 100 * 1024,
    mimes: /^image\/webp$/,
    label: "sticker (webp, máx. 100 KB)",
  },
  audio: {
    maxBytes: 16 * 1024 * 1024,
    mimes: /^audio\/(aac|mp4|mpeg|amr|ogg|opus)/,
    label: "audio (aac/mp4/mpeg/amr/ogg, máx. 16 MB)",
  },
  video: {
    maxBytes: 16 * 1024 * 1024,
    mimes: /^video\/(mp4|3gpp)$/,
    label: "video (mp4/3gpp, máx. 16 MB)",
  },
  document: {
    maxBytes: 100 * 1024 * 1024,
    mimes: /^[\w.-]+\/[\w.+-]+$/,
    label: "documento (máx. 100 MB)",
  },
};

/** Testo libero in uscita: lo stesso tetto delle route di oggi (`max(4096)`). */
export const WHATSAPP_MAX_TEXT = 4096;

export const whatsappCapabilities: ChannelCapabilities = {
  replyWindow: { kind: "rolling", ms: WHATSAPP_WINDOW_MS },
  templates: "required_outside_window",
  inboundMedia: ["image", "video", "audio", "document", "sticker", "location", "contacts"],
  outboundMedia: {
    kinds: ["image", "video", "audio", "document", "location", "contacts"],
    maxBytes: {
      image: MEDIA_LIMITS.image.maxBytes,
      video: MEDIA_LIMITS.video.maxBytes,
      audio: MEDIA_LIMITS.audio.maxBytes,
      document: MEDIA_LIMITS.document.maxBytes,
    },
  },
  maxTextLength: WHATSAPP_MAX_TEXT,
  threads: "single",
  echoes: true,
  typingIndicator: true,
  readReceipts: true,
  identityScope: "organization",
};
