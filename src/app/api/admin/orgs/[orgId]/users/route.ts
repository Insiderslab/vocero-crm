import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { withSuperadmin } from "@/server/auth/superadmin";

export const dynamic = "force-dynamic";

// Next invoca el handler como (request, routeCtx); el wrapper antepone el
// contexto super-admin: (ctx, request, routeCtx).
type RouteCtx = { params: Promise<{ orgId: string }> };

async function orgExists(orgId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1);
  return rows.length > 0;
}

/** Miembros de una organización (super-admin). */
export const GET = withSuperadmin(
  async (_ctx, _req: Request, route: RouteCtx) => {
    const { orgId } = await route.params;
    if (!(await orgExists(orgId))) {
      return apiError(404, "not_found", "Organización no encontrada");
    }
    const db = getDb();
    const members = await db
      .select({
        id: schema.member.id,
        role: schema.member.role,
        createdAt: schema.member.createdAt,
        name: schema.user.name,
        email: schema.user.email,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .where(eq(schema.member.organizationId, orgId))
      .orderBy(asc(schema.member.createdAt));
    return Response.json({
      members: members.map((m) => ({
        id: m.id,
        role: m.role,
        name: m.name,
        email: m.email,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  }
);

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  role: z.enum(["owner", "member"]).default("member"),
});

/**
 * Crea una cuenta dentro de una organización (super-admin). Mismo patrón que
 * el alta de equipo del propietario: bypass interno del registro cerrado +
 * membresía explícita.
 */
export const POST = withSuperadmin(
  async (_ctx, req: Request, route: RouteCtx) => {
    const { orgId } = await route.params;
    if (!(await orgExists(orgId))) {
      return apiError(404, "not_found", "Organización no encontrada");
    }
    const body = await parseBody(req, createUserSchema);
    if (!body.ok) return body.response;

    const auth = getAuth();
    let newUserId: string;
    try {
      const result = await runInternalSignup(() =>
        auth.api.signUpEmail({
          body: {
            name: body.data.name,
            email: body.data.email,
            password: body.data.password,
          },
        })
      );
      newUserId = result.user.id;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "No se pudo crear la cuenta";
      if (/exist/i.test(message)) {
        return apiError(409, "duplicate", "Ya existe una cuenta con ese correo");
      }
      return apiError(422, "invalid", message);
    }

    const db = getDb();
    await db
      .insert(schema.member)
      .values({
        id: newId("member"),
        organizationId: orgId,
        userId: newUserId,
        role: body.data.role,
      })
      .onConflictDoNothing();

    return Response.json({ ok: true }, { status: 201 });
  }
);
