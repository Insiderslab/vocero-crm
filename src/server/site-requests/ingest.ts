import { asc, eq, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { insertContactIfAbsent, webMessageIds } from "@/server/channels/dual-write";
import { publish } from "@/server/events/bus";
import { getOrCreateConversation, serializeMessage } from "@/server/inbox/ingest";
import { onLeadActivity } from "@/server/inbox/lead-activity";
import { formatSiteRequest, type SiteRequest } from "@/server/site-requests/validation";

/**
 * 008 — Ingesta de una solicitud del formulario del sitio. La organización ya
 * viene de la clave (la ruta la autenticó); nada de aquí la toma del body.
 *
 * Diferencias con un entrante de WhatsApp, a propósito:
 * - el mensaje es `channel = web`, sin ID de proveedor;
 * - NO toca `last_inbound_at`: la ventana de 24 h de WhatsApp no se abre;
 * - NO llama a `maybeRunAgentTurn`: el agente no contesta por WhatsApp a una
 *   solicitud web (y `runAgentTurn` además ignora los entrantes `web`).
 */

type ContactRow = typeof schema.contact.$inferSelect;

export type SiteIngestResult =
  | {
      ok: true;
      contactId: string;
      conversationId: string;
      messageId: string;
      contactCreated: boolean;
    }
  /** Solo email y ningún contacto con ese email: sin identidad WhatsApp que crear (spec 008, D1). */
  | { ok: false; code: "phone_required" };

async function findContact(organizationId: string, req: SiteRequest): Promise<ContactRow | null> {
  const db = getDb();
  if (req.phone) {
    const rows = await db
      .select()
      .from(schema.contact)
      .where(
        scoped(
          schema.contact.organizationId,
          organizationId,
          or(eq(schema.contact.waIdentity, req.phone), eq(schema.contact.phone, req.phone))
        )
      )
      .orderBy(asc(schema.contact.createdAt))
      .limit(1);
    if (rows[0]) return rows[0];
  }
  if (req.email) {
    const rows = await db
      .select()
      .from(schema.contact)
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.email, req.email)))
      .orderBy(asc(schema.contact.createdAt))
      .limit(1);
    if (rows[0]) return rows[0];
  }
  return null;
}

/**
 * Contacto existente: SOLO se reactiva si estaba archivado. El formulario es
 * público y sin verificar, así que JAMÁS escribe ni pisa `phone`,
 * `wa_identity`, `email` (ni el nombre) de un contacto que ya existe, ni une
 * dos contactos: la lista de acceso del agente (007) autoriza por
 * `wa_identity` O `phone`, y un formulario no puede dar identidad a nadie.
 * Lo que trae la solicitud queda en el texto del mensaje.
 */
async function touchExisting(organizationId: string, c: ContactRow): Promise<void> {
  if (!c.archivedAt) return;
  await getDb()
    .update(schema.contact)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, c.id)));
}

async function resolveContact(
  organizationId: string,
  req: SiteRequest
): Promise<{ contact: ContactRow; created: boolean } | null> {
  const existing = await findContact(organizationId, req);
  if (existing) {
    await touchExisting(organizationId, existing);
    return { contact: existing, created: false };
  }
  if (!req.phone) return null;

  // 005 (R1): el contacto y su identidad WhatsApp (= teléfono), en una
  // transacción, como el alta manual. `source = "sito"` marca además que el
  // teléfono y el email NO están verificados: los escribió un visitante en un
  // formulario público (spec 008, «Sicurezza»).
  const inserted = await insertContactIfAbsent({
    id: newId("contact"),
    organizationId,
    waIdentity: req.phone,
    phone: req.phone,
    email: req.email,
    name: req.name,
    source: "sito",
  });
  if (inserted) return { contact: inserted, created: true };

  // Carrera: otra solicitud (o un webhook) lo creó entre el SELECT y el INSERT.
  const raced = await findContact(organizationId, req);
  if (!raced) throw new Error("contacto no encontrado tras upsert");
  await touchExisting(organizationId, raced);
  return { contact: raced, created: false };
}

export async function ingestSiteRequest(
  organizationId: string,
  req: SiteRequest
): Promise<SiteIngestResult> {
  const db = getDb();
  const resolved = await resolveContact(organizationId, req);
  if (!resolved) return { ok: false, code: "phone_required" };
  const { contact, created } = resolved;

  const conversation = await getOrCreateConversation(organizationId, contact.id);
  const now = new Date();

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      ...webMessageIds(),
      direction: "in",
      type: "text",
      text: formatSiteRequest(req),
      status: "delivered",
    })
    .returning();
  const message = inserted[0];
  if (!message) throw new Error("mensaje web no insertado");

  // No leída y arriba en la bandeja; `last_inbound_at` NO (ventana cerrada).
  await db
    .update(schema.conversation)
    .set({
      lastMessageAt: now,
      unreadCount: sql`${schema.conversation.unreadCount} + 1`,
      updatedAt: now,
    })
    .where(
      scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversation.id))
    );

  // Lead en la primera etapa abierta (o actividad del que ya existe), como un
  // entrante de WhatsApp.
  await onLeadActivity(organizationId, contact.id, now);

  publish(organizationId, {
    type: "message.new",
    data: { conversationId: conversation.id, message: serializeMessage(message) },
  });
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });

  return {
    ok: true,
    contactId: contact.id,
    conversationId: conversation.id,
    messageId: message.id,
    contactCreated: created,
  };
}
