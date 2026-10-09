import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { describeGraphRouting } from "@/lib/meta/client";
import { canManageApiKeys } from "@/lib/roles";
import {
  getWapiKeyStatus,
  isValidWapiKeyFormat,
  revokeWapiKey,
  saveWapiKey,
} from "@/server/whatsapp/wapi-credentials";

export const dynamic = "force-dynamic";

/**
 * C3 — Clave Wapi de la organización activa. Solo owner/admin. La clave en
 * claro entra por el PUT y NUNCA sale: ninguna respuesta la incluye (solo
 * `last4`), y el cuerpo recibido no se refleja en errores ni en logs.
 */

const NO_STORE = { "cache-control": "no-store" };

const forbidden = () =>
  apiError(403, "forbidden", "Solo owner o admin gestionan la clave de Wapi");

/** Estado público: existencia, últimos 4 y cómo se enruta hoy la organización. */
async function statusBody(organizationId: string) {
  const status = await getWapiKeyStatus(organizationId);
  return {
    gatewayEnabled: Boolean(getEnv().WAPI_BASE_URL),
    configured: status.configured,
    last4: status.configured ? status.last4 : null,
    updatedAt: status.configured ? status.updatedAt.toISOString() : null,
    routing: describeGraphRouting(organizationId, status.configured),
  };
}

export const GET = withAuth(async (session) => {
  if (!canManageApiKeys(session.role)) return forbidden();
  return Response.json(await statusBody(session.organizationId), {
    headers: NO_STORE,
  });
});

const putSchema = z.object({ key: z.string().trim().max(200) });

export const PUT = withAuth(async (session, req: Request) => {
  if (!canManageApiKeys(session.role)) return forbidden();
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  if (!isValidWapiKeyFormat(body.data.key)) {
    return apiError(
      422,
      "invalid_wapi_key",
      "La clave de Wapi debe empezar por hlp_live_"
    );
  }
  await saveWapiKey({
    organizationId: session.organizationId,
    key: body.data.key,
    createdBy: session.userId,
  });
  return Response.json(await statusBody(session.organizationId), {
    headers: NO_STORE,
  });
});

/** Revoca la clave (idempotente). Sin clave propia no hay desvío con clave ajena. */
export const DELETE = withAuth(async (session) => {
  if (!canManageApiKeys(session.role)) return forbidden();
  await revokeWapiKey(session.organizationId);
  return Response.json(await statusBody(session.organizationId), {
    headers: NO_STORE,
  });
});
