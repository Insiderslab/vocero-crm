import { asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

/** Tags de la org con su número de contactos (custom heili.cloud). */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const tags = await db
    .select()
    .from(schema.tag)
    .where(scoped(schema.tag.organizationId, session.organizationId))
    .orderBy(asc(schema.tag.name));

  const counts = await db
    .select({ tagId: schema.contactTag.tagId, n: count() })
    .from(schema.contactTag)
    .where(scoped(schema.contactTag.organizationId, session.organizationId))
    .groupBy(schema.contactTag.tagId);
  const countByTag = new Map(counts.map((c) => [c.tagId, c.n]));

  return Response.json({
    tags: tags.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      contactCount: countByTag.get(t.id) ?? 0,
    })),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color en formato #rrggbb")
    .optional(),
});

/**
 * Crea un tag. Nombre repetido → devuelve el existente (200): la UI crea al
 * vuelo mientras etiqueta y un 409 la obligaría a manejar una carrera que al
 * usuario no le importa.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const inserted = await db
    .insert(schema.tag)
    .values({
      id: newId("tag"),
      organizationId: session.organizationId,
      name: body.data.name,
      color: body.data.color ?? null,
    })
    .onConflictDoNothing({
      target: [schema.tag.organizationId, schema.tag.name],
    })
    .returning();
  if (inserted[0]) {
    return Response.json({ tag: inserted[0] }, { status: 201 });
  }
  const existing = await db
    .select()
    .from(schema.tag)
    .where(
      scoped(
        schema.tag.organizationId,
        session.organizationId,
        eq(schema.tag.name, body.data.name)
      )
    )
    .limit(1);
  return Response.json({ tag: existing[0] });
});
