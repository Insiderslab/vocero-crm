import type { schema } from "@/lib/db";

/**
 * DTO de un mensaje para la API y los eventos SSE (`message.new`). Contrato
 * publicado (FR-010): solo admite campos ADITIVOS (M1.3: `channel`).
 */
export function serializeMessage(
  m: typeof schema.message.$inferSelect,
  media: typeof schema.mediaAsset.$inferSelect | null = null
) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction,
    type: m.type,
    text: m.text,
    status: m.status,
    /** Motivo del fallo, ya traducido a algo accionable (`describeSendError`). */
    error: m.error,
    aiGenerated: m.aiGenerated,
    origin: m.origin,
    /**
     * 005 (M1.3, T033) — canal del mensaje. Campo ADITIVO declarado (FR-010):
     * los golden lo aceptan solo porque está en `DECLARED_ADDITIVE_KEYS`.
     */
    channel: m.channel,
    media: media
      ? {
          assetId: media.id,
          kind: media.kind,
          mimeType: media.mimeType,
          fileName: media.fileName,
          fileSize: media.fileSize,
          caption: media.caption,
          fetchStatus: media.fetchStatus,
          payload: media.payload,
        }
      : null,
    createdAt: (m.waTimestamp ?? m.createdAt).toISOString(),
  };
}
