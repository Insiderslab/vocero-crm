import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getContactById } from "@/server/contacts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const putSchema = z.object({
  tagIds: z.array(z.string().min(1)).max(50),
});

/**
 * Reemplazo total de los tags de un contacto (custom heili.cloud). Los tags
 * deben ser de la misma org — de otro tenant jamás se escribe nada.
 */
export const PUT = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const contact = await getContactById(session.organizationId, id);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");

  const db = getDb();
  const tagIds = [...new Set(body.data.tagIds)];
  if (tagIds.length > 0) {
    const valid = await db
      .select({ id: schema.tag.id })
      .from(schema.tag)
      .where(
        scoped(
          schema.tag.organizationId,
          session.organizationId,
          inArray(schema.tag.id, tagIds)
        )
      );
    if (valid.length !== tagIds.length) {
      return apiError(422, "invalid_tags", "Hay etiquetas que no existen");
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.contactTag)
      .where(
        scoped(
          schema.contactTag.organizationId,
          session.organizationId,
          eq(schema.contactTag.contactId, id)
        )
      );
    if (tagIds.length > 0) {
      await tx.insert(schema.contactTag).values(
        tagIds.map((tagId) => ({
          id: newId("contactTag"),
          organizationId: session.organizationId,
          contactId: id,
          tagId,
        }))
      );
    }
  });

  const tags = await db
    .select({
      id: schema.tag.id,
      name: schema.tag.name,
      color: schema.tag.color,
    })
    .from(schema.contactTag)
    .innerJoin(schema.tag, eq(schema.contactTag.tagId, schema.tag.id))
    .where(
      scoped(
        schema.contactTag.organizationId,
        session.organizationId,
        eq(schema.contactTag.contactId, id)
      )
    );
  return Response.json({ tags });
});
