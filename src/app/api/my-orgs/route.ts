import { asc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Organizaciones del usuario autenticado (custom multi-org): alimenta el
 * selector de empresa de la barra lateral. Cualquier usuario con membresías
 * puede listar las suyas — no expone nada de otras orgs.
 */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const orgs = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
    })
    .from(schema.member)
    .innerJoin(
      schema.organization,
      eq(schema.member.organizationId, schema.organization.id)
    )
    .where(eq(schema.member.userId, session.userId))
    .orderBy(asc(schema.organization.createdAt));

  return Response.json({
    orgs,
    activeOrgId: session.organizationId,
  });
});
