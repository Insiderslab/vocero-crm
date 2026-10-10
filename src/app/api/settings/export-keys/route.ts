import { withAdminAuth } from "@/lib/api";
import { createApiKey, listApiKeys } from "@/server/api-keys-admin";

export const dynamic = "force-dynamic";

/** Claves de `/api/export/*` de la organización activa (solo owner/admin). */
export const GET = withAdminAuth(listApiKeys("export"));
export const POST = withAdminAuth(createApiKey("export"));
