import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export type UserOrg = { id: string; name: string };

/** Organizaciones de las que el usuario es miembro, en orden de creación. */
export async function listUserOrgs(userId: string): Promise<UserOrg[]> {
  const db = getDb();
  return db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
    })
    .from(schema.member)
    .innerJoin(
      schema.organization,
      eq(schema.member.organizationId, schema.organization.id)
    )
    .where(eq(schema.member.userId, userId))
    .orderBy(asc(schema.organization.createdAt));
}
