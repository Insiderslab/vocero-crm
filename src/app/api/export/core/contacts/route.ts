import { asc, eq, inArray, max, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { withExport } from "@/server/export/handler";
import { feedList, keysetAfter, microIso, parseFeedParams } from "@/server/listening/feed";

export const dynamic = "force-dynamic";

/**
 * 016 — Contatti per Heili Core. Cursore su `(changed_at, id)` con
 * `changed_at = greatest(updated_at, archived_at, max(identità.created_at))`:
 * un'identità aggiunta dopo fa ricomparire il contatto; un contatto archiviato
 * esce come `{ id, deleted: true, changedAt }` e nient'altro (segnale di
 * cancellazione). MAI note, scheda (`ficha`), tag o dati della trattativa.
 */
export const GET = withExport(async (org, url) => {
  const params = parseFeedParams(url);
  if (params instanceof Response) return params;

  const db = getDb();
  const c = schema.contact;
  const ci = schema.contactIdentity;
  const lastIdentity = db
    .select({ at: max(ci.createdAt) })
    .from(schema.contactIdentity)
    .where(scoped(schema.contactIdentity.organizationId, org.id, eq(ci.contactId, c.id)));
  const changedAt = sql`greatest(${c.updatedAt}, ${c.archivedAt}, (${lastIdentity}))`;

  const rows = await db
    .select({
      id: c.id,
      name: c.name,
      phone: c.phone,
      waIdentity: c.waIdentity,
      waUserId: c.waUserId,
      email: c.email,
      source: c.source,
      archivedAt: c.archivedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      cursorTs: microIso(changedAt),
    })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, org.id, keysetAfter(changedAt, c.id, params.after)))
    .orderBy(asc(changedAt), asc(c.id))
    .limit(params.limit);

  const live = rows.filter((r) => !r.archivedAt).map((r) => r.id);
  const identityRows = live.length
    ? await db
        .select({
          contactId: ci.contactId,
          channel: ci.channel,
          externalId: ci.externalId,
          channelAccountId: ci.channelAccountId,
        })
        .from(schema.contactIdentity)
        .where(scoped(schema.contactIdentity.organizationId, org.id, inArray(ci.contactId, live)))
        .orderBy(asc(ci.createdAt), asc(ci.id))
    : [];
  const identitiesOf = new Map<string, { channel: string; externalId: string; channelAccountId: string | null }[]>();
  for (const { contactId, ...identity } of identityRows) {
    identitiesOf.set(contactId, [...(identitiesOf.get(contactId) ?? []), identity]);
  }

  const items = rows.map((r) => {
    const changed = new Date(r.cursorTs).toISOString();
    if (r.archivedAt) return { id: r.id, deleted: true, changedAt: changed };
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      waIdentity: r.waIdentity,
      waUserId: r.waUserId,
      email: r.email,
      source: r.source,
      identities: identitiesOf.get(r.id) ?? [],
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      changedAt: changed,
    };
  });
  return feedList(org.id, items, rows.at(-1));
});
