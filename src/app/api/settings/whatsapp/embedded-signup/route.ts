import { z } from "zod";
import { apiError, parseBody, withAdminAuth } from "@/lib/api";
import {
  completeEmbeddedSignup,
  EmbeddedSignupError,
  getEmbeddedSignupConfig,
} from "@/server/whatsapp/embedded-signup";

export const dynamic = "force-dynamic";

/**
 * 009 — Config del Embedded Signup (App ID + Config ID, no secretos). Solo
 * owner/admin: es la única gente que ve y usa el botón.
 */
export const GET = withAdminAuth(async () => {
  return Response.json(getEmbeddedSignupConfig());
});

const postSchema = z.object({
  code: z.string().trim().min(1).max(4096),
  wabaId: z.string().trim().regex(/^\d{5,25}$/, "WABA ID inválido"),
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, "Phone Number ID inválido")
    .nullish(),
  // Solo coexistence por ahora: un número NUEVO de Cloud API necesita además
  // `/register` con PIN, que este flujo no hace (se usa el wizard manual).
  coexistence: z.literal(true),
});

/**
 * 009 — Cierra el Embedded Signup: canje del code, validación, guardado
 * cifrado, suscripción y (coexistence) pedido de sincronización.
 * Solo owner/admin: conecta el número de toda la organización.
 */
export const POST = withAdminAuth(async (session, req: Request) => {
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  try {
    const result = await completeEmbeddedSignup({
      organizationId: session.organizationId,
      code: body.data.code,
      wabaId: body.data.wabaId,
      phoneNumberId: body.data.phoneNumberId ?? null,
      coexistence: body.data.coexistence,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof EmbeddedSignupError) {
      return apiError(err.status, err.code, err.message);
    }
    throw err;
  }
});
