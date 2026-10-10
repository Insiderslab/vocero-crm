import { apiError, withAdminAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import {
  hasDemoData,
  isDomainEmpty,
  removeDemo,
  seedDemo,
} from "@/server/seed/demo";

export const dynamic = "force-dynamic";

/** 007 — ¿Hay datos demo que quitar en la organización? (para el botón). */
export const GET = withAdminAuth(async (session) => {
  const db = getDb();
  return Response.json({
    hasDemo: await hasDemoData(db, session.organizationId),
  });
});

/**
 * Carga el negocio demo (FR-075). Solo con la BD de dominio vacía — la
 * versión por script (`pnpm seed:demo`) permite recargar con --force.
 */
export const POST = withAdminAuth(async (session) => {
  const db = getDb();
  const empty = await isDomainEmpty(db, session.organizationId);
  if (!empty) {
    return apiError(
      409,
      "not_empty",
      "Ya hay datos en la organización; la demo solo se carga con la base vacía"
    );
  }
  const result = await seedDemo(db, session.organizationId);
  return Response.json({ ok: true, ...result });
});

/**
 * 007 — Quita los datos demo SOLO de la organización de la sesión (contactos
 * demo con su historial y el KB demo sin editar). Idempotente.
 */
export const DELETE = withAdminAuth(async (session) => {
  const result = await removeDemo(getDb(), session.organizationId);
  return Response.json({ ok: true, ...result });
});
