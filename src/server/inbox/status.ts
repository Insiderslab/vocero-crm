import {
  applyStatusUpdate as applyChannelStatusUpdate,
  isUpgrade,
} from "@/server/channels/core/status";
import type { WebhookStatus } from "@/server/inbox/webhook";

/**
 * Estados de entrega de WhatsApp. 005 (M1.3): módulo delgado sobre el núcleo
 * (`channels/core/status.ts`), mismas firmas exportadas.
 */

export { isUpgrade };

export async function applyStatusUpdate(
  organizationId: string,
  status: WebhookStatus
): Promise<void> {
  const failure = status.errors?.[0];
  await applyChannelStatusUpdate(organizationId, {
    channel: "whatsapp",
    externalMessageId: status.id,
    status: status.status,
    error: {
      ...(failure?.code !== undefined ? { code: failure.code } : {}),
      ...((failure?.message ?? failure?.title) !== undefined
        ? { message: failure?.message ?? failure?.title }
        : {}),
    },
  });
}
