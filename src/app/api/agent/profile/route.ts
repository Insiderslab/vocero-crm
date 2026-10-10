import { z } from "zod";
import { apiError, parseBody, withAuth, withAdminAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";
import { isOrgAdmin } from "@/lib/roles";
import { ALLOWLIST_MAX, parseAllowlist } from "@/server/ai/allowlist";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  const p = rows[0];
  if (!p) return apiError(404, "not_found", "Perfil del agente no encontrado");
  return Response.json({
    profile: {
      enabled: p.enabled,
      name: p.name,
      tone: p.tone,
      instructions: p.instructions,
      escalationRules: p.escalationRules,
      greeting: p.greeting,
    },
    // 007: los números del equipo solo los ve quien puede cambiarlos.
    ...(isOrgAdmin(session.role)
      ? {
          restriction: {
            restrictToAllowlist: p.restrictToAllowlist,
            allowedIdentities: p.allowedIdentities,
            outsiderReply: p.outsiderReply,
          },
        }
      : {}),
    aiConfigured: isAiConfigured(),
  });
});

const putSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(60).optional(),
  tone: z.string().max(500).nullable().optional(),
  instructions: z.string().max(8000).nullable().optional(),
  escalationRules: z.string().max(4000).nullable().optional(),
  greeting: z.string().max(1000).nullable().optional(),
  // 007 — Acceso reservado.
  restrictToAllowlist: z.boolean().optional(),
  /** Texto (un número por línea) o lista; se normaliza y deduplica aquí. */
  allowedIdentities: z
    .union([z.string().max(20_000), z.array(z.string().max(40)).max(ALLOWLIST_MAX * 2)])
    .optional(),
  /** Vacío → null (sin respuesta a externos). */
  outsiderReply: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null)),
});

export const PUT = withAdminAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const { allowedIdentities, ...rest } = body.data;
  let identities: string[] | undefined;
  if (allowedIdentities !== undefined) {
    const parsed = parseAllowlist(allowedIdentities);
    if (!parsed.ok) {
      return Response.json(
        {
          error: {
            code: parsed.tooMany ? "too_many_identities" : "invalid_identities",
            message: parsed.tooMany
              ? `Máximo ${ALLOWLIST_MAX} números`
              : "Números no válidos: usa solo dígitos con código de país (ej. +39 347 123 4567)",
            invalid: parsed.invalid,
          },
        },
        { status: 422 }
      );
    }
    identities = parsed.identities;
  }

  const db = getDb();
  const updated = await db
    .update(schema.agentProfile)
    .set({
      ...rest,
      ...(identities !== undefined ? { allowedIdentities: identities } : {}),
      updatedAt: new Date(),
    })
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Perfil no encontrado");
  return Response.json({
    ok: true,
    restriction: {
      restrictToAllowlist: updated[0].restrictToAllowlist,
      allowedIdentities: updated[0].allowedIdentities,
      outsiderReply: updated[0].outsiderReply,
    },
  });
});
