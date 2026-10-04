import { eq, isNull } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

/** Revoca una clave de bot de la organización activa (idempotente). */
export const DELETE = withAuth(
  async (session, _req: Request, ctx: { params: Promise<{ id: string }> }) => {
    if (session.role !== "owner" && session.role !== "admin") {
      return apiError(403, "forbidden", "Solo owner o admin gestionan las claves de bot");
    }
    const { id } = await ctx.params;
    const db = getDb();
    const rows = await db
      .select({ id: schema.botApiKey.id })
      .from(schema.botApiKey)
      .where(scoped(schema.botApiKey.organizationId, session.organizationId, eq(schema.botApiKey.id, id)))
      .limit(1);
    // Una clave de otra organización responde igual que una inexistente.
    if (!rows[0]) return apiError(404, "not_found", "Clave no encontrada");
    await db
      .update(schema.botApiKey)
      .set({ revokedAt: new Date() })
      .where(
        scoped(
          schema.botApiKey.organizationId,
          session.organizationId,
          eq(schema.botApiKey.id, id),
          isNull(schema.botApiKey.revokedAt)
        )
      );
    return new Response(null, { status: 204 });
  }
);
