import { asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { withExport } from "@/server/export/handler";
import { feedList, keysetAfter, microIso, parseFeedParams } from "@/server/listening/feed";

export const dynamic = "force-dynamic";

/**
 * 016 — Conversazioni per Heili Core. Cursore su `(updated_at, id)`; escluse
 * quelle del Laboratorio (`is_test`). `channel` è quello della cuenta
 * (`whatsapp` se non c'è). Escluse anche quelle di un contatto archiviato:
 * per il Core quel contatto è `deleted` (core/contacts) e i suoi dati non
 * devono ricomparire da un'altra lista.
 */
export const GET = withExport(async (org, url) => {
  const params = parseFeedParams(url);
  if (params instanceof Response) return params;

  const cv = schema.conversation;
  const rows = await getDb()
    .select({
      id: cv.id,
      contactId: cv.contactId,
      channel: sql<string>`coalesce(${schema.channelAccount.channel}, 'whatsapp')`,
      channelAccountId: cv.channelAccountId,
      aiEnabled: cv.aiEnabled,
      lastInboundAt: cv.lastInboundAt,
      createdAt: cv.createdAt,
      updatedAt: cv.updatedAt,
      cursorTs: microIso(cv.updatedAt),
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      scoped(
        schema.contact.organizationId,
        org.id,
        eq(schema.contact.id, cv.contactId),
        isNull(schema.contact.archivedAt)
      )
    )
    .leftJoin(
      schema.channelAccount,
      scoped(
        schema.channelAccount.organizationId,
        org.id,
        eq(schema.channelAccount.id, cv.channelAccountId)
      )
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        org.id,
        eq(cv.isTest, false),
        keysetAfter(cv.updatedAt, cv.id, params.after)
      )
    )
    .orderBy(asc(cv.updatedAt), asc(cv.id))
    .limit(params.limit);

  const items = rows.map(({ cursorTs: _cursorTs, ...r }) => ({
    ...r,
    lastInboundAt: r.lastInboundAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
  return feedList(org.id, items, rows.at(-1));
});
