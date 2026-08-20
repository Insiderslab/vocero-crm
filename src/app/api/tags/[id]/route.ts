import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Borra un tag; sus asignaciones caen en cascada (custom heili.cloud). */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const deleted = await db
    .delete(schema.tag)
    .where(scoped(schema.tag.organizationId, session.organizationId, eq(schema.tag.id, id)))
    .returning({ id: schema.tag.id });
  if (!deleted[0]) return apiError(404, "not_found", "Etiqueta no encontrada");
  return Response.json({ ok: true });
});
