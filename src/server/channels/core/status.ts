import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { describeSendError } from "@/lib/meta/send-errors";
import { publish } from "@/server/events/bus";
import type { ChannelKind } from "@/server/channels/types";

/**
 * 005-livello-canali (M1.3, T028) — Estados de entrega en el núcleo, iguales
 * para todos los canales (Constitución IV): monótonos y SIEMPRE filtrados por
 * la organización de la cuenta que recibió el evento (un wamid de A que llega
 * por el número de B no toca el mensaje de A). R2: el mensaje se busca por
 * `(organization_id, channel, external_message_id)` (plan §5.2).
 */

/** Orden monotónico de estados: nunca degradar (un delivered tardío no pisa read). */
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export function isUpgrade(current: string, next: string): boolean {
  if (next === "failed") return current !== "failed";
  const c = STATUS_RANK[current];
  const n = STATUS_RANK[next];
  if (c === undefined || n === undefined) return false;
  return n > c;
}

export type StatusUpdate = {
  channel: ChannelKind;
  externalMessageId: string;
  status: string;
  error?: { code?: number; message?: string };
};

export async function applyStatusUpdate(
  organizationId: string,
  update: StatusUpdate
): Promise<void> {
  const next = update.status;
  if (!(next in STATUS_RANK) && next !== "failed") return; // estado desconocido

  const db = getDb();
  const rows = await db
    .select({
      id: schema.message.id,
      conversationId: schema.message.conversationId,
      status: schema.message.status,
    })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.channel, update.channel),
        eq(schema.message.externalMessageId, update.externalMessageId)
      )
    )
    .limit(1);
  const msg = rows[0];
  if (!msg) return;
  if (!isUpgrade(msg.status, next)) return;

  const error =
    next === "failed"
      ? describeSendError(update.error?.code, update.error?.message)
      : null;

  await db
    .update(schema.message)
    .set({ status: next as MessageStatus, error })
    .where(eq(schema.message.id, msg.id));

  publish(organizationId, {
    type: "message.status",
    data: {
      conversationId: msg.conversationId,
      messageId: msg.id,
      status: next,
      // Sin esto el operador ve el triángulo de fallo pero nunca el motivo.
      error,
    },
  });
}
