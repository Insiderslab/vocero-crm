import { desc } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { generateBotKey } from "@/server/bot/auth";

export const dynamic = "force-dynamic";

/** Solo owner/admin gestionan las claves de la API de servicio `/api/bot/*`. */
function canManage(role: string): boolean {
  return role === "owner" || role === "admin";
}

/** Claves de bot de la organización activa (nunca el hash ni el texto plano). */
export const GET = withAuth(async (session) => {
  if (!canManage(session.role)) {
    return apiError(403, "forbidden", "Solo owner o admin gestionan las claves de bot");
  }
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
    .where(scoped(schema.botApiKey.organizationId, session.organizationId))
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

const createSchema = z.object({
  label: z.string().trim().min(1).max(80),
});

/** Crea una clave para la organización activa. El texto plano sale UNA vez. */
export const POST = withAuth(async (session, req: Request) => {
  if (!canManage(session.role)) {
    return apiError(403, "forbidden", "Solo owner o admin gestionan las claves de bot");
  }
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const key = generateBotKey();
  const id = newId("botApiKey");
  await getDb().insert(schema.botApiKey).values({
    id,
    organizationId: session.organizationId,
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
