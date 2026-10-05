import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { generateApiKey, type ApiKeyScope } from "@/server/api-keys";

/**
 * Gestión de claves de servicio por organización, una sola fuente para
 * `/api/settings/bot-keys` y `/api/settings/export-keys`. Solo owner/admin, y
 * siempre dentro de la organización de la sesión y del ámbito de la ruta.
 */

function canManage(role: string): boolean {
  return role === "owner" || role === "admin";
}

const forbidden = () =>
  apiError(403, "forbidden", "Solo owner o admin gestionan las claves de servicio");

const createSchema = z.object({
  label: z.string().trim().min(1).max(80),
});

/** GET (listar, nunca hash ni texto plano) y POST (crear) de un ámbito. */
export function apiKeyCollectionHandlers(scope: ApiKeyScope) {
  const GET = withAuth(async (session) => {
    if (!canManage(session.role)) return forbidden();
    const rows = await getDb()
      .select({
        id: schema.botApiKey.id,
        label: schema.botApiKey.label,
        keyPrefix: schema.botApiKey.keyPrefix,
        createdAt: schema.botApiKey.createdAt,
        lastUsedAt: schema.botApiKey.lastUsedAt,
        revokedAt: schema.botApiKey.revokedAt,
      })
      .from(schema.botApiKey)
      .where(
        scoped(
          schema.botApiKey.organizationId,
          session.organizationId,
          eq(schema.botApiKey.scope, scope)
        )
      )
      .orderBy(desc(schema.botApiKey.createdAt));
    return Response.json({
      keys: rows.map((k) => ({
        id: k.id,
        label: k.label,
        keyPrefix: k.keyPrefix,
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        revokedAt: k.revokedAt?.toISOString() ?? null,
      })),
    });
  });

  /** Crea una clave para la organización activa. El texto plano sale UNA vez. */
  const POST = withAuth(async (session, req: Request) => {
    if (!canManage(session.role)) return forbidden();
    const body = await parseBody(req, createSchema);
    if (!body.ok) return body.response;

    const key = generateApiKey(scope);
    const id = newId("botApiKey");
    await getDb().insert(schema.botApiKey).values({
      id,
      organizationId: session.organizationId,
      scope,
      label: body.data.label,
      keyPrefix: key.prefix,
      keyHash: key.hash,
      createdBy: session.userId,
    });
    return Response.json(
      { id, label: body.data.label, keyPrefix: key.prefix, key: key.plain },
      { status: 201, headers: { "cache-control": "no-store" } }
    );
  });

  return { GET, POST };
}

/** DELETE: revoca una clave del ámbito en la organización activa (idempotente). */
export function apiKeyRevokeHandler(scope: ApiKeyScope) {
  return withAuth(
    async (session, _req: Request, ctx: { params: Promise<{ id: string }> }) => {
      if (!canManage(session.role)) return forbidden();
      const { id } = await ctx.params;
      const db = getDb();
      const rows = await db
        .select({ id: schema.botApiKey.id })
        .from(schema.botApiKey)
        .where(
          scoped(
            schema.botApiKey.organizationId,
            session.organizationId,
            eq(schema.botApiKey.id, id),
            eq(schema.botApiKey.scope, scope)
          )
        )
        .limit(1);
      // Una clave de otra organización u otro ámbito responde igual que una inexistente.
      if (!rows[0]) return apiError(404, "not_found", "Clave no encontrada");
      await db
        .update(schema.botApiKey)
        .set({ revokedAt: new Date() })
        .where(
          scoped(
            schema.botApiKey.organizationId,
            session.organizationId,
            eq(schema.botApiKey.id, id),
            eq(schema.botApiKey.scope, scope),
            isNull(schema.botApiKey.revokedAt)
          )
        );
      return new Response(null, { status: 204 });
    }
  );
}
