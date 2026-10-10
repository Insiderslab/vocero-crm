import { withAdminAuth } from "@/lib/api";
import { revokeApiKey } from "@/server/api-keys-admin";

export const dynamic = "force-dynamic";

/** Revoca una clave del ámbito `bot` de la organización activa (idempotente, solo owner/admin). */
export const DELETE = withAdminAuth(revokeApiKey("bot"));
