import { apiKeyCollectionHandlers } from "@/server/api-keys-admin";

export const dynamic = "force-dynamic";

/** Claves de `/api/export/*` de la organización activa (solo owner/admin). */
const handlers = apiKeyCollectionHandlers("export");
export const GET = handlers.GET;
export const POST = handlers.POST;
