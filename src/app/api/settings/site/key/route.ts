import { withAdminAuth } from "@/lib/api";
import { revokeSiteKey, rotateSiteKey } from "@/server/site-requests/config";

export const dynamic = "force-dynamic";

/**
 * 008 — Crea la clave del sitio (`vsk_…`) y revoca la anterior en la misma
 * transacción: crear = rotar, una sola clave activa por organización. El
 * texto plano sale UNA vez, aquí. Solo owner/admin.
 */
export const POST = withAdminAuth(async (session) => {
  const created = await rotateSiteKey(session.organizationId, session.userId);
  return Response.json(
    { id: created.id, keyPrefix: created.keyPrefix, key: created.key, rotated: created.revoked > 0 },
    { status: 201, headers: { "cache-control": "no-store" } }
  );
});

/** Revoca la clave del sitio (idempotente): el formulario deja de funcionar. */
export const DELETE = withAdminAuth(async (session) => {
  const revoked = await revokeSiteKey(session.organizationId);
  return Response.json({ revoked });
});
