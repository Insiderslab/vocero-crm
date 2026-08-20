import { asc, count } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { slugify, uniqueSlug } from "@/lib/slug";
import { provisionOrganization } from "@/server/auth/on-signup";
import { withSuperadmin } from "@/server/auth/superadmin";

export const dynamic = "force-dynamic";

/**
 * Panel admin multi-empresa (custom heili.cloud): lista todas las
 * organizaciones de la instancia con conteos básicos. Solo super-admin.
 */
export const GET = withSuperadmin(async () => {
  const db = getDb();
  const orgs = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      createdAt: schema.organization.createdAt,
    })
    .from(schema.organization)
    .orderBy(asc(schema.organization.createdAt));

  const memberCounts = await db
    .select({ organizationId: schema.member.organizationId, n: count() })
    .from(schema.member)
    .groupBy(schema.member.organizationId);
  const contactCounts = await db
    .select({ organizationId: schema.contact.organizationId, n: count() })
    .from(schema.contact)
    .groupBy(schema.contact.organizationId);

  const membersByOrg = new Map(memberCounts.map((r) => [r.organizationId, r.n]));
  const contactsByOrg = new Map(
    contactCounts.map((r) => [r.organizationId, r.n])
  );

  return Response.json({
    orgs: orgs.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      createdAt: o.createdAt.toISOString(),
      memberCount: membersByOrg.get(o.id) ?? 0,
      contactCount: contactsByOrg.get(o.id) ?? 0,
    })),
  });
});

const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(120),
  // Opcional: la cuenta del primer usuario del cliente (queda owner de la org).
  owner: z
    .object({
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email(),
      password: z.string().min(8).max(128),
    })
    .optional(),
});

/**
 * Crea una organización (con pipeline y perfil de agente sembrados) y deja al
 * super-admin como miembro owner para poder operarla. Si viene `owner`, crea
 * también la cuenta del primer usuario del cliente — primero, para que un
 * correo duplicado falle sin dejar la org a medias.
 */
export const POST = withSuperadmin(async (ctx, req: Request) => {
  const body = await parseBody(req, createOrgSchema);
  if (!body.ok) return body.response;

  let ownerUserId: string | null = null;
  if (body.data.owner) {
    const auth = getAuth();
    try {
      const result = await runInternalSignup(() =>
        auth.api.signUpEmail({
          body: {
            name: body.data.owner!.name,
            email: body.data.owner!.email,
            password: body.data.owner!.password,
          },
        })
      );
      ownerUserId = result.user.id;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "No se pudo crear la cuenta";
      if (/exist/i.test(message)) {
        return apiError(409, "duplicate", "Ya existe una cuenta con ese correo");
      }
      return apiError(422, "invalid", message);
    }
  }

  const db = getDb();
  const existing = await db
    .select({ slug: schema.organization.slug })
    .from(schema.organization);
  const slug = uniqueSlug(
    slugify(body.data.name),
    existing.map((r) => r.slug ?? "")
  );

  const orgId = newId("organization");
  await db.transaction(async (tx) => {
    await tx.insert(schema.organization).values({
      id: orgId,
      name: body.data.name,
      slug,
    });
    await tx.insert(schema.member).values({
      id: newId("member"),
      organizationId: orgId,
      userId: ctx.userId,
      role: "owner",
    });
    if (ownerUserId) {
      await tx.insert(schema.member).values({
        id: newId("member"),
        organizationId: orgId,
        userId: ownerUserId,
        role: "owner",
      });
    }
    await provisionOrganization(tx, orgId);
  });

  return Response.json(
    { org: { id: orgId, name: body.data.name, slug } },
    { status: 201 }
  );
});
