/** DTOs que viajan por la API interna (lado cliente). */

export type ConversationDto = {
  id: string;
  contact: { id: string; name: string; phone: string | null; email?: string | null };
  stageName: string | null;
  aiEnabled: boolean;
  handoffAt: string | null;
  handoffReason: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  windowOpen: boolean;
  windowRemainingMs: number;
  preview: string | null;
};

/** 008 — Adjunto de un mensaje, para previsualización en el hilo. */
export type MessageMediaDto = {
  assetId: string;
  kind:
    | "image"
    | "video"
    | "audio"
    | "document"
    | "sticker"
    | "location"
    | "contacts";
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  caption: string | null;
  fetchStatus: "available" | "pending" | "failed";
  /** location {latitude, longitude, name?, address?} / contacts (subset). */
  payload: unknown;
};

export type MessageDto = {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  type: string;
  text: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  /** Motivo del fallo en lenguaje llano cuando status = "failed". */
  error: string | null;
  aiGenerated: boolean;
  /** 008 — Origen del saliente (en entrantes viene 'operator' y se ignora). */
  origin: "ai" | "operator" | "manual" | "template";
  /**
   * 008 — Solo viaja cuando NO es WhatsApp (hoy: `web`, solicitud del sitio):
   * así el contrato de los mensajes de WhatsApp no cambia.
   */
  channel?: "web";
  media: MessageMediaDto | null;
  createdAt: string;
};

export type TemplateDto = {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  status: "draft" | "pending" | "approved" | "rejected";
  rejectionReason: string | null;
};

export type StageDto = {
  id: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
};

/** Un dato de la ficha. Escalar a propósito: ver `server/bot/ficha`. */
export type FichaValue = string | number | boolean;

/**
 * Ficha de calificación del lead. Claves libres: cada negocio califica
 * distinto, así que las define quien pregunta —el agente o el dueño— y el CRM
 * no las cablea.
 */
export type FichaDto = Record<string, FichaValue>;

export type ContactDto = {
  id: string;
  name: string;
  /** null en contactos que llegaron solo con BSUID (003). */
  phone: string | null;
  /** 008 — email (atributo, no identidad); lo trae el formulario del sitio. */
  email?: string | null;
  notes: string | null;
  /** Etapa del embudo del lead asociado; null si el contacto no tiene lead. */
  stageName: string | null;
  archivedAt: string | null;
  /** De dónde salió el prospecto, capturada o deducida. */
  source?: SourceDto;
  /** Prioridad del lead asociado; null si nadie la fijó. */
  priority?: PriorityValue | null;
  /** Lo que se sabe del lead. `{}` mientras nadie haya calificado. */
  ficha?: FichaDto;
  /** Etiquetas del contacto (custom heili.cloud). */
  tags?: TagDto[];
};

/** Etiqueta de contacto (custom heili.cloud). */
export type TagDto = {
  id: string;
  name: string;
  color: string | null;
};

/* ============================================================
 * Bitácora de etapas
 * ============================================================ */

/** Por qué se perdió un trato. Lista corta a propósito: una taxonomía larga
 *  se responde "otro" y deja de informar. */
export type LossReason =
  | "precio"
  | "no_es_perfil"
  | "sin_presupuesto"
  | "eligio_otro"
  | "nunca_contesto"
  | "otro";

export const LOSS_REASON_LABEL: Record<LossReason, string> = {
  precio: "Le pareció caro",
  no_es_perfil: "No era el perfil",
  sin_presupuesto: "Sin presupuesto ahora",
  eligio_otro: "Se fue con otro",
  nunca_contesto: "Nunca contestó",
  otro: "Otro",
};

/** Quién provocó un movimiento de etapa. */
export type StageChangeSource = "dueno" | "bot" | "sistema" | "migracion";

/* ============================================================
 * Fuente del prospecto
 * ============================================================ */

export type SourceValue =
  | "anuncio"
  | "organico"
  | "referido"
  | "conocido"
  | "otro"
  /** 008 — llegó por el formulario del sitio web (lo pone la solicitud, no el dueño). */
  | "sito";

export type SourceDto = {
  /** "desconocida" cuando nadie la capturó y no se pudo deducir. */
  value: SourceValue | "desconocida";
  /** `deducida` = la infirió el sistema; `capturada` = la puso el dueño. */
  source: "capturada" | "deducida";
};

/* ============================================================
 * Prioridad del lead
 * ============================================================ */

/** La fija el dueño; NULL = nadie la ha decidido (no es "media"). */
export type PriorityValue = "alta" | "media" | "baja";
