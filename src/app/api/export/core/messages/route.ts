import { asc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { withExport } from "@/server/export/handler";
import { feedList, keysetAfter, microIso, parseFeedParams } from "@/server/listening/feed";

export const dynamic = "force-dynamic";

/**
 * 016 — Messaggi per Heili Core. Cursore su `(created_at, id)`: è l'ora di
 * inserimento in Orbit, non quella di WhatsApp, quindi un messaggio arrivato
 * in ritardo ha comunque un `created_at` nuovo. Il consumatore rilegge con 5
 * minuti di sovrapposizione e deduplica per `id` (transazioni che finiscono in
 * ordine diverso). Esclusi i messaggi del Laboratorio. Nessun file né URL:
 * solo `hasMedia`. Esclusi i messaggi di un contatto archiviato (`deleted`
 * per il Core in core/contacts).
 */
export const GET = withExport(async (org, url) => {
  const params = parseFeedParams(url);
  if (params instanceof Response) return params;

  const m = schema.message;
  const rows = await getDb()
    .select({
      id: m.id,
      conversationId: m.conversationId,
      contactId: schema.conversation.contactId,
      channel: m.channel,
      direction: m.direction,
      origin: m.origin,
      aiGenerated: m.aiGenerated,
      type: m.type,
      text: m.text,
      waTimestamp: m.waTimestamp,
      createdAt: m.createdAt,
      hasMedia: isNotNull(m.mediaAssetId).mapWith(Boolean),
      cursorTs: microIso(m.createdAt),
    })
    .from(schema.message)
    .innerJoin(
      schema.conversation,
      scoped(
        schema.conversation.organizationId,
        org.id,
        eq(m.conversationId, schema.conversation.id)
      )
    )
    .innerJoin(
      schema.contact,
      scoped(
        schema.contact.organizationId,
        org.id,
        eq(schema.contact.id, schema.conversation.contactId),
        isNull(schema.contact.archivedAt)
      )
    )
    .where(
      scoped(
        schema.message.organizationId,
        org.id,
        eq(schema.conversation.isTest, false),
        keysetAfter(m.createdAt, m.id, params.after)
      )
    )
    .orderBy(asc(m.createdAt), asc(m.id))
    .limit(params.limit);

  const items = rows.map(({ cursorTs: _cursorTs, ...r }) => ({
    ...r,
    waTimestamp: r.waTimestamp?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
  return feedList(org.id, items, rows.at(-1));
});
