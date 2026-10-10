import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAdminAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  intervalDays: z.number().int().min(1).max(3650).optional(),
  enabled: z.boolean().optional(),
});

/** Edita nombre/cadencia o pausa/reanuda una regla. */
export const PATCH = withAdminAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const updated = await db
    .update(schema.automationRule)
    .set({
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.intervalDays !== undefined
        ? { intervalDays: body.data.intervalDays }
        : {}),
      ...(body.data.enabled !== undefined ? { enabled: body.data.enabled } : {}),
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.automationRule.organizationId,
        session.organizationId,
        eq(schema.automationRule.id, id)
      )
    )
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Regla no encontrada");
  return Response.json({ rule: updated[0] });
});

/** Borra la regla; su bitácora cae en cascada. */
export const DELETE = withAdminAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const deleted = await db
    .delete(schema.automationRule)
    .where(
      scoped(
        schema.automationRule.organizationId,
        session.organizationId,
        eq(schema.automationRule.id, id)
      )
    )
    .returning({ id: schema.automationRule.id });
  if (!deleted[0]) return apiError(404, "not_found", "Regla no encontrada");
  return Response.json({ ok: true });
});
