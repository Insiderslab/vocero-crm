import { withAdminAuth } from "@/lib/api";
import { createApiKey, listApiKeys } from "@/server/api-keys-admin";

export const dynamic = "force-dynamic";

/** Claves de `/api/bot/*` de la organización activa (solo owner/admin). */
export const GET = withAdminAuth(listApiKeys("bot"));
export const POST = withAdminAuth(createApiKey("bot"));
