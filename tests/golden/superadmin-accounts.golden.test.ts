import { describe, expect, it, vi } from "vitest";
import { getSql } from "@/lib/db";
import { ORG_A } from "./setup";

/**
 * 013 (revisione PR #15) — Super-admin = email in SUPERADMIN_EMAILS. Se
 * chiunque potesse CREARE un account con quell'email, diventerebbe super-admin
 * e potrebbe cambiare la configurazione Meta dell'istanza. Qui, con
 * PostgreSQL e Better Auth veri (solo la sessione delle NOSTRE rotte è un
 * doppio), ogni via di creazione rifiuta l'email con un generico «email non
 * disponibile» e senza scrivere righe, salvo il bootstrap e /admin.
 */

vi.hoisted(() => {
  process.env.SUPERADMIN_EMAILS = "root@golden.test, super@golden.test, super2@golden.test";
});

const auth = vi.hoisted(() => ({
  session: null as null | {
    user: { id: string; email: string };
    session: { activeOrganizationId: string | null };
  },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getAuth: () => {
      const real = actual.getAuth();
      return { ...real, api: { ...real.api, getSession: async () => auth.session } };
    },
  };
});

import { getAuth } from "@/lib/auth";
import { POST as teamPost } from "@/app/api/settings/team/route";
import { POST as adminUsersPost } from "@/app/api/admin/orgs/[orgId]/users/route";

const sql = () => getSql();
const BASE = process.env.APP_BASE_URL!;

async function seedOwnerAndRoot() {
  for (const u of [
    { id: "usr_g_owner", email: "owner@golden.test", role: "owner" },
    { id: "usr_g_root", email: "root@golden.test", role: "owner" },
  ]) {
    await sql()`insert into "user" (id, name, email) values (${u.id}, ${u.id}, ${u.email})`;
    await sql()`insert into member (id, organization_id, user_id, role) values (${`mem_${u.id}`}, ${ORG_A}, ${u.id}, ${u.role})`;
  }
}

function as(id: string, email: string) {
  auth.session = { user: { id, email }, session: { activeOrganizationId: ORG_A } };
}

async function usersWithEmail(email: string): Promise<number> {
  const [row] = await sql()<{ n: string }[]>`select count(*) as n from "user" where lower(email) = lower(${email})`;
  return Number(row!.n);
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE },
  body: JSON.stringify(body),
});

describe("013 — un'email di super-admin non si crea da fuori", () => {
  it("owner → alta di equipo con l'email di un super-admin: 403 generico, nessuna riga", async () => {
    await seedOwnerAndRoot();
    as("usr_g_owner", "owner@golden.test");
    for (const email of ["super@golden.test", " Super@Golden.TEST "]) {
      const res = await teamPost(
        new Request("http://localhost/api/settings/team", json({ name: "Intruso", email, password: "password-golden-1" }))
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toEqual({ code: "email_unavailable", message: "Email non disponibile" });
      // Il messaggio non rivela il motivo.
      expect(JSON.stringify(body).toLowerCase()).not.toContain("admin");
    }
    expect(await usersWithEmail("super@golden.test")).toBe(0);
  });

  it("owner → alta di equipo con un'email normale: funziona come prima", async () => {
    await seedOwnerAndRoot();
    as("usr_g_owner", "owner@golden.test");
    const res = await teamPost(
      new Request("http://localhost/api/settings/team", json({ name: "Collega", email: "collega@golden.test", password: "password-golden-1" }))
    );
    expect(res.status).toBe(201);
    expect(await usersWithEmail("collega@golden.test")).toBe(1);
  });

  it("registro aperto (ALLOW_SIGNUP=true) con l'email di un super-admin: 403, nessuna riga", async () => {
    process.env.ALLOW_SIGNUP = "true";
    try {
      const res = await getAuth().handler(
        new Request(`${BASE}/api/auth/sign-up/email`, json({ name: "X", email: "super@golden.test", password: "password-golden-1" }))
      );
      expect(res.status).toBe(403);
      expect((await res.json()).message).toBe("Email non disponibile");
      expect(await usersWithEmail("super@golden.test")).toBe(0);
    } finally {
      delete process.env.ALLOW_SIGNUP;
    }
  });

  it("invito a un'email di super-admin: 403, nessun invito", async () => {
    const res = await getAuth().handler(
      new Request(
        `${BASE}/api/auth/organization/invite-member`,
        json({ email: "super@golden.test", role: "member", organizationId: ORG_A })
      )
    );
    expect(res.status).toBe(403);
    const [row] = await sql()<{ n: string }[]>`select count(*) as n from invitation`;
    expect(Number(row!.n)).toBe(0);
  });

  it("dal pannello /admin (super-admin) l'account si crea", async () => {
    await seedOwnerAndRoot();
    as("usr_g_root", "root@golden.test");
    const res = await adminUsersPost(
      new Request(`http://localhost/api/admin/orgs/${ORG_A}/users`, json({ name: "Secondo admin", email: "super2@golden.test", password: "password-golden-1" })),
      { params: Promise.resolve({ orgId: ORG_A }) }
    );
    expect(res.status).toBe(201);
    expect(await usersWithEmail("super2@golden.test")).toBe(1);
  });

  it("bootstrap: istanza senza organizzazioni → il primo registro con l'email di super-admin funziona", async () => {
    await sql()`truncate organization cascade`;
    const res = await getAuth().handler(
      new Request(`${BASE}/api/auth/sign-up/email`, json({ name: "Root", email: "super@golden.test", password: "password-golden-1" }))
    );
    expect(res.status).toBe(200);
    expect(await usersWithEmail("super@golden.test")).toBe(1);
  });
});
