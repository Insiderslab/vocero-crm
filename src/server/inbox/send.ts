import { SendError } from "@/server/channels/errors";
import {
  sendMediaMessage as coreSendMediaMessage,
  sendStructured as coreSendStructured,
  sendText as coreSendText,
  type ContactInput,
  type LocationInput,
} from "@/server/channels/core/send";
import { callGraphMessages } from "@/server/channels/whatsapp/send";
import {
  markReconnectRequired,
  type Credentials,
} from "@/server/whatsapp/credentials";

/**
 * Envío por la conversación. 005 (M1.3, T031): módulo DELGADO con las mismas
 * firmas exportadas. El orden de los controles (existencia + tenant → sandbox
 * → ventana → cuenta → destinatario) vive en el núcleo
 * (`src/server/channels/core/send.ts`), el diálogo con Graph en el adaptador
 * de WhatsApp (`src/server/channels/whatsapp/send.ts`).
 */

/** Error tipado del envío; `code` mapea a HTTP en la capa de API. */
export { SendError };
export type { ContactInput, LocationInput };

type SendResult = { messageId: string };

/** Envía un mensaje de texto libre por WhatsApp. */
export async function sendText(input: {
  conversationId: string;
  organizationId: string;
  text: string;
  aiGenerated?: boolean;
}): Promise<SendResult> {
  return coreSendText(input);
}

/** 008 — Envía un adjunto de archivo (imagen/video/audio/documento). */
export async function sendMediaMessage(input: {
  conversationId: string;
  organizationId: string;
  file: { data: Buffer; mimeType: string; fileName?: string };
  caption?: string;
}): Promise<SendResult> {
  return coreSendMediaMessage(input);
}

/** 008 — Envía una ubicación o contactos (payload estructurado, sin archivo). */
export async function sendStructured(
  input: {
    conversationId: string;
    organizationId: string;
  } & (
    | { kind: "location"; location: LocationInput }
    | { kind: "contacts"; contacts: ContactInput[] }
  )
): Promise<SendResult> {
  return coreSendStructured(input);
}

/** Llama a Graph /messages y traduce errores de Meta a SendError. */
export async function callGraphSend(
  credentials: Credentials,
  payload: unknown
): Promise<string> {
  return callGraphMessages(
    {
      organizationId: credentials.organizationId,
      phoneNumberId: credentials.phoneNumberId,
      token: credentials.token,
      markReconnectRequired: () => markReconnectRequired(credentials.organizationId),
    },
    payload
  );
}
