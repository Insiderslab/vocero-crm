import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { withSuperadmin } from "@/server/auth/superadmin";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ orgId: string }> };

const renameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

/**
 * 007 — Renombra una organización (super-admin). Solo el nombre visible: el
 * `slug` no cambia, así los enlaces y la marca siguen estables.
 */
export const PATCH = withSuperadmin(
  async (_ctx, req: Request, route: RouteCtx) => {
    const { orgId } = await route.params;
    const body = await parseBody(req, renameSchema);
    if (!body.ok) return body.response;

    const updated = await getDb()
      .update(schema.organization)
      .set({ name: body.data.name })
      .where(eq(schema.organization.id, orgId))
      .returning({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
      });
    const org = updated[0];
    if (!org) return apiError(404, "not_found", "Organización no encontrada");
    return Response.json({ org });
  }
);
