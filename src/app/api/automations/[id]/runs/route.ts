import { desc, eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Bitácora reciente de una regla (últimos 50 eventos). */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();

  const rules = await db
    .select({ id: schema.automationRule.id })
    .from(schema.automationRule)
    .where(
      scoped(
        schema.automationRule.organizationId,
        session.organizationId,
        eq(schema.automationRule.id, id)
      )
    )
    .limit(1);
  if (!rules[0]) return apiError(404, "not_found", "Regla no encontrada");

  const runs = await db
    .select({
      id: schema.automationRun.id,
      contactName: schema.contact.name,
      contactPhone: schema.contact.phone,
      status: schema.automationRun.status,
      detail: schema.automationRun.detail,
      createdAt: schema.automationRun.createdAt,
    })
    .from(schema.automationRun)
    .innerJoin(
      schema.contact,
      eq(schema.automationRun.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.automationRun.organizationId,
        session.organizationId,
        eq(schema.automationRun.ruleId, id)
      )
    )
    .orderBy(desc(schema.automationRun.createdAt))
    .limit(50);

  return Response.json({
    runs: runs.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  });
});
