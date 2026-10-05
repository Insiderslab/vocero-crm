import { apiKeyRevokeHandler } from "@/server/api-keys-admin";

export const dynamic = "force-dynamic";

/** Revoca una clave de `/api/export/*` de la organización activa (idempotente). */
export const DELETE = apiKeyRevokeHandler("export");
