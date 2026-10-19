import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { withSuperadmin } from "@/server/auth/superadmin";
import { DELETION_STATUSES, updateDeletionRequest, type DeletionStatus } from "@/server/meta/data-deletion";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const input = z
  .object({
    status: z.enum(DELETION_STATUSES as [DeletionStatus, ...DeletionStatus[]]),
    note: z
      .union([z.string().max(1000), z.null()])
      .optional()
      .transform((v) => (v ?? "").trim() || null),
  })
  .strict();

/**
 * 015 — Cambia lo stato di una richiesta (ricevuta → in corso → completata)
 * con una nota su cosa è stato cancellato. Solo super-admin. La pagina
 * pubblica /cancellazione-dati?id=<codice> mostra subito il nuovo stato.
 */
export const PATCH = withSuperadmin(async (ctx, req: Request, { params }: Params) => {
  const body = await parseBody(req, input);
  if (!body.ok) return body.response;
  const { id } = await params;
  const ok = await updateDeletionRequest({
    id,
    status: body.data.status,
    note: body.data.note ?? null,
    updatedBy: ctx.userId,
  });
  if (!ok) return apiError(404, "not_found", "Richiesta non trovata");
  return Response.json({ ok: true });
});
