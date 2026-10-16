import {
  graphRequest,
  MetaApiError,
  normalizeRecipient,
  WAPI_KEY_MISSING_MESSAGE,
} from "@/lib/meta/client";
import { SendError } from "@/server/channels/errors";
import type { OutboundMessage, SendContext } from "@/server/channels/types";
import { uploadGraphMedia } from "@/server/whatsapp/media";

/**
 * 005-livello-canali (M1.3, T027) — Envío por WhatsApp Cloud API.
 *
 * Es `callGraphSend` y la construcción de los payloads de `sendText`,
 * `sendMediaMessage`, `sendStructured` (antes en `src/server/inbox/send.ts`) y
 * `sendTemplate` (`src/server/whatsapp/templates.ts`), con el MISMO cuerpo
 * hacia Graph y la MISMA traducción de errores a `SendError`. El adaptador no
 * escribe en la BD: un token vencido se marca con `ctx.markReconnectRequired()`
 * (lo implementa el núcleo).
 */

const RECONNECT_MESSAGE =
  "El token de WhatsApp expiró: reconecta el número en Configuración";

/** Credenciales mínimas para Graph (la vista que da el núcleo en el contexto). */
export type GraphSender = {
  organizationId: string;
  phoneNumberId: string;
  token: string;
  markReconnectRequired(): Promise<void>;
};

export function senderOf(ctx: SendContext | Omit<SendContext, "recipient">): GraphSender {
  return {
    organizationId: ctx.organizationId,
    phoneNumberId: ctx.account.externalAccountId,
    token: ctx.secret ?? "",
    markReconnectRequired: () => ctx.markReconnectRequired(),
  };
}

/**
 * 003: destinatario = teléfono normalizado o, si el contacto llegó por BSUID
 * sin teléfono, su Business-Scoped User ID. null = ninguno utilizable.
 */
export function whatsappRecipient(identity: {
  phone: string | null;
  providerUserId: string | null;
}): string | null {
  return identity.phone ? normalizeRecipient(identity.phone) : identity.providerUserId;
}

/** Llama a Graph /messages y traduce errores de Meta a SendError. */
export async function callGraphMessages(sender: GraphSender, payload: unknown): Promise<string> {
  try {
    const res = await graphRequest<{ messages?: { id: string }[] }>(
      `${sender.phoneNumberId}/messages`,
      {
        method: "POST",
        token: sender.token,
        body: payload,
        organizationId: sender.organizationId,
      }
    );
    const id = res.messages?.[0]?.id;
    if (!id) throw new SendError("meta_error", "Meta no devolvió ID de mensaje");
    return id;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await sender.markReconnectRequired();
        throw new SendError("reconnect_required", RECONNECT_MESSAGE);
      }
      if (err.isWapiKeyMissing) {
        throw new SendError("wapi_key_missing", WAPI_KEY_MISSING_MESSAGE);
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError("meta_unavailable", "Meta no está disponible ahora");
      }
      throw new SendError("meta_error", err.message);
    }
    throw err;
  }
}

/**
 * Adjunto: subida a Graph (`/media`), aviso al núcleo con el media id (ANTES
 * del envío, como hoy) y envío. Cualquier fallo de la subida se traduce como
 * hoy: 401/190 → reconnect_required (marcando la cuenta), clave Wapi →
 * wapi_key_missing, el resto → upload_failed. Un SendError del envío pasa tal cual.
 */
async function sendMedia(
  ctx: SendContext,
  message: Extract<OutboundMessage, { kind: "media" }>
): Promise<string> {
  const sender = senderOf(ctx);
  try {
    const waMediaId = await uploadGraphMedia(
      {
        organizationId: sender.organizationId,
        phoneNumberId: sender.phoneNumberId,
        token: sender.token,
      },
      message.file
    );
    await ctx.onMediaUploaded?.(waMediaId);

    const kind = message.mediaKind;
    const mediaPayload: Record<string, unknown> = { id: waMediaId };
    if (message.caption && kind !== "audio") mediaPayload.caption = message.caption;
    if (kind === "document" && message.file.fileName) {
      mediaPayload.filename = message.file.fileName;
    }
    return await callGraphMessages(sender, {
      messaging_product: "whatsapp",
      to: ctx.recipient.externalId,
      type: kind,
      [kind]: mediaPayload,
    });
  } catch (err) {
    if (err instanceof SendError) throw err;
    if (err instanceof MetaApiError && err.isAuthError) {
      // Mismo criterio que el texto: SOLO 401/código 190 (fix 2026-08-04).
      await sender.markReconnectRequired();
      throw new SendError("reconnect_required", RECONNECT_MESSAGE);
    }
    if (err instanceof MetaApiError && err.isWapiKeyMissing) {
      throw new SendError("wapi_key_missing", WAPI_KEY_MISSING_MESSAGE);
    }
    throw new SendError("upload_failed", "No se pudo subir el adjunto a WhatsApp");
  }
}

/** Cuerpo de Graph para cada mensaje normalizado (idéntico al de hoy). */
export function graphPayloadOf(
  to: string,
  message: Exclude<OutboundMessage, { kind: "media" }>
): Record<string, unknown> {
  switch (message.kind) {
    case "text":
      return { messaging_product: "whatsapp", to, type: "text", text: { body: message.text } };
    case "location":
      return { messaging_product: "whatsapp", to, type: "location", location: message.location };
    case "contacts":
      return {
        messaging_product: "whatsapp",
        to,
        type: "contacts",
        contacts: message.contacts.map((c) => ({
          name: { formatted_name: c.name, first_name: c.name },
          phones: [{ phone: c.phone, type: "CELL" }],
        })),
      };
    case "template":
      return {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: message.name,
          language: { code: message.language },
          ...(message.variables.length > 0
            ? {
                components: [
                  {
                    type: "body",
                    parameters: message.variables.map((text) => ({ type: "text", text })),
                  },
                ],
              }
            : {}),
        },
      };
  }
}

export async function sendWhatsapp(
  ctx: SendContext,
  message: OutboundMessage
): Promise<{ externalMessageId: string }> {
  if (message.kind === "media") {
    return { externalMessageId: await sendMedia(ctx, message) };
  }
  const externalMessageId = await callGraphMessages(
    senderOf(ctx),
    graphPayloadOf(ctx.recipient.externalId, message)
  );
  return { externalMessageId };
}
