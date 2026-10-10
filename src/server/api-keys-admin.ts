import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import type { SessionContext } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { generateApiKey, type ApiKeyScope } from "@/server/api-keys";

/**
 * Gestión de claves de servicio por organización, una sola fuente para
 * `/api/settings/bot-keys` y `/api/settings/export-keys`. Aquí solo va la lógica,
 * siempre dentro de la organización de la sesión y del ámbito de la ruta: el
 * control de rol (solo owner/admin) lo pone cada ruta con `withAdminAuth`, que
 * es la única fuente del 403.
 */

const createSchema = z.object({
  label: z.string().trim().min(1).max(80),
});

/** Listar claves de un ámbito (nunca hash ni texto plano). */
export function listApiKeys(scope: ApiKeyScope) {
  return async (session: SessionContext): Promise<Response> => {
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
  };
}

/** Crea una clave para la organización activa. El texto plano sale UNA vez. */
export function createApiKey(scope: ApiKeyScope) {
  return async (session: SessionContext, req: Request): Promise<Response> => {
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
  };
}

/** DELETE: revoca una clave del ámbito en la organización activa (idempotente). */
export function revokeApiKey(scope: ApiKeyScope) {
  return async (
    session: SessionContext,
    _req: Request,
    ctx: { params: Promise<{ id: string }> }
  ): Promise<Response> => {
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
  };
}
