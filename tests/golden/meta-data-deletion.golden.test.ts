import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { getSql } from "@/lib/db";
import { buildSignedRequest } from "@/server/meta/signed-request";
import {
  deletionStatusByCode,
  listDeletionRequests,
  registerDeletionRequest,
} from "@/server/meta/data-deletion";
import { ORG_A } from "./setup";

/**
 * 015 — Callback di cancellazione dati di Meta su PostgreSQL vero
 * (specs/custom-heili/015-cancellazione-dati-meta.md). Aserciones explícitas,
 * sin instantánea. El secreto es el SINTÉTICO de tests/golden/env.ts.
 */

vi.hoisted(() => {
  process.env.SUPERADMIN_EMAILS = "root@golden.test";
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
  return { ...actual, getAuth: () => ({ api: { getSession: async () => auth.session } }) };
});

import { POST as deletionPost } from "@/app/api/meta/data-deletion/route";
import { GET as adminList } from "@/app/api/admin/meta-deletion/route";
import { PATCH as adminPatch } from "@/app/api/admin/meta-deletion/[id]/route";

const sql = () => getSql();
const SECRET = () => process.env.META_APP_SECRET!;
const WRONG = "golden-wrong-secret-not-real";

function post(signed: string) {
  return deletionPost(
    new Request("http://localhost:3000/api/meta/data-deletion", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `signed_request=${encodeURIComponent(signed)}`,
    })
  );
}
const payload = (userId: string) => ({ algorithm: "HMAC-SHA256", issued_at: 1_893_499_200, user_id: userId });

async function rows() {
  return sql()<{ meta_user_id: string; confirmation_code: string; status: string; issued_at: Date | null }[]>`
    select meta_user_id, confirmation_code, status, issued_at from meta_data_deletion_request order by created_at
  `;
}

async function seedUsers() {
  for (const u of [
    { id: "usr_golden_owner", email: "owner@golden.test", role: "owner" },
    { id: "usr_golden_root", email: "root@golden.test", role: "owner" },
  ]) {
    await sql()`insert into "user" (id, name, email) values (${u.id}, ${u.id}, ${u.email})`;
    await sql()`insert into member (id, organization_id, user_id, role) values (${`mem_${u.id}`}, ${ORG_A}, ${u.id}, ${u.role})`;
  }
}
function as(who: "owner" | "root" | null) {
  auth.session = who
    ? {
        user: { id: `usr_golden_${who}`, email: `${who}@golden.test` },
        session: { activeOrganizationId: ORG_A },
      }
    : null;
}

describe("015 — POST /api/meta/data-deletion su PostgreSQL vero", () => {
  it("firma valida: 200, una riga «received» con codice, user_id e issued_at", async () => {
    const res = await post(buildSignedRequest(payload("555000111"), SECRET()));
    expect(res.status).toBe(200);
    const body = await res.json();
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ meta_user_id: "555000111", status: "received", confirmation_code: body.confirmation_code });
    expect(new Date(r[0]!.issued_at as unknown as string).toISOString()).toBe(
      new Date(Date.UTC(2030, 0, 1, 12)).toISOString()
    );
    expect(body.url).toBe(`${process.env.APP_BASE_URL}/cancellazione-dati?id=${body.confirmation_code}`);
  });

  it("firma errata o payload malformato: 400 e nessuna riga", async () => {
    expect((await post(buildSignedRequest(payload("555000111"), WRONG))).status).toBe(400);
    expect((await post("non.valido")).status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it("Meta riprova per lo stesso utente: stesso codice, nessuna riga doppia", async () => {
    const a = await (await post(buildSignedRequest(payload("555000222"), SECRET()))).json();
    const b = await (await post(buildSignedRequest(payload("555000222"), SECRET()))).json();
    expect(b.confirmation_code).toBe(a.confirmation_code);
    expect(await rows()).toHaveLength(1);
  });

  it("callback SIMULTANEI per la stessa persona: il secondo aspetta il lock del primo, una sola riga", async () => {
    // Nei golden il pool ha UNA connessione e le chiamate parallele andrebbero
    // comunque in fila: il lock si prova da una SECONDA connessione vera che lo
    // tiene occupato, come farebbe un callback concorrente.
    const other = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    let settled = false;
    let pending: Promise<{ code: string; reused: boolean }> | null = null;
    try {
      await other.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${"meta-deletion:555000999"}))`;
        await tx`insert into meta_data_deletion_request (id, meta_user_id, confirmation_code)
                 values ('mdd_concorrente', '555000999', 'CONCORRENTE000000000')`;
        pending = registerDeletionRequest({ metaUserId: "555000999", issuedAt: null });
        void pending.then(() => (settled = true));
        await new Promise((r) => setTimeout(r, 400));
        expect(settled).toBe(false); // bloccato sul lock finché l'altra transazione non chiude
      });
    } finally {
      await other.end();
    }
    const r = await pending!;
    expect(r).toEqual({ code: "CONCORRENTE000000000", reused: true });
    expect(await rows()).toHaveLength(1);
  });

  it("dopo una richiesta completata, una nuova richiesta ha un codice nuovo", async () => {
    const first = await registerDeletionRequest({ metaUserId: "555000333", issuedAt: null });
    await sql()`update meta_data_deletion_request set status = 'completed', completed_at = now()`;
    const second = await registerDeletionRequest({ metaUserId: "555000333", issuedAt: null });
    expect(second.reused).toBe(false);
    expect(second.code).not.toBe(first.code);
    expect(await rows()).toHaveLength(2);
  });

  it("codici: 20 caratteri alfanumerici, diversi tra loro; il CHECK del database li impone", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) codes.add((await registerDeletionRequest({ metaUserId: `u${i}`, issuedAt: null })).code);
    expect(codes.size).toBe(20);
    for (const c of codes) expect(c).toMatch(/^[A-Za-z0-9]{20}$/);
    await expect(
      sql()`insert into meta_data_deletion_request (id, meta_user_id, confirmation_code) values ('mdd_x', 'u', 'corto')`
    ).rejects.toThrow(/meta_data_deletion_code_ck/);
  });

  it("stato pubblico: solo stato e date; codice inesistente → null", async () => {
    const { code } = await registerDeletionRequest({ metaUserId: "555000444", issuedAt: null });
    const s = await deletionStatusByCode(code);
    expect(s).toMatchObject({ status: "received", completedAt: null });
    expect(JSON.stringify(s)).not.toContain("555000444");
    expect(await deletionStatusByCode("ZZZZZZZZZZ0000000000")).toBeNull();
  });
});

describe("015 — elenco: nessuna richiesta aperta sparisce", () => {
  it("una richiesta aperta vecchia resta in elenco anche con 150 completate più recenti", async () => {
    await registerDeletionRequest({ metaUserId: "vecchia-aperta", issuedAt: null });
    await sql()`update meta_data_deletion_request set created_at = now() - interval '20 days'`;
    await sql()`
      insert into meta_data_deletion_request (id, meta_user_id, confirmation_code, status, completed_at)
      select 'mdd_c' || g, 'c' || g, lpad(g::text, 20, 'X'), 'completed', now()
      from generate_series(1, 150) g`;
    const list = await listDeletionRequests();
    expect(list[0]?.metaUserId).toBe("vecchia-aperta");
    expect(list.filter((r) => r.status === "completed")).toHaveLength(100);
  });
});

describe("015 — /admin: solo super-admin", () => {
  it("owner di un'azienda (non super-admin) → 403 su elenco e cambio di stato", async () => {
    await seedUsers();
    as("owner");
    expect((await adminList()).status).toBe(403);
    const res = await adminPatch(
      new Request("http://localhost/api/admin/meta-deletion/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      }),
      { params: Promise.resolve({ id: "x" }) }
    );
    expect(res.status).toBe(403);
  });

  it("super-admin: elenco con giorni rimasti, poi «completata» con nota → la pagina pubblica lo vede", async () => {
    await seedUsers();
    as("root");
    const { code } = await registerDeletionRequest({ metaUserId: "555000555", issuedAt: null });
    // created_at lo scrive PostgreSQL (orologio reale); l'arnés congela JS al 2030.
    await sql()`update meta_data_deletion_request set created_at = ${new Date(Date.now() - 3_600_000).toISOString()}::timestamp`;
    const list = await (await adminList()).json();
    expect(list.requests).toHaveLength(1);
    expect(list.requests[0]).toMatchObject({ metaUserId: "555000555", status: "received" });
    expect(list.requests[0].daysLeft).toBeGreaterThanOrEqual(29);
    const id = list.requests[0].id as string;
    const res = await adminPatch(
      new Request(`http://localhost/api/admin/meta-deletion/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed", note: "Nessun account CRM collegato" }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const s = await deletionStatusByCode(code);
    expect(s?.status).toBe("completed");
    expect(s?.completedAt).not.toBeNull();
    const after = await listDeletionRequests();
    expect(after[0]).toMatchObject({ status: "completed", note: "Nessun account CRM collegato", daysLeft: null });
    // Un PATCH senza `note` non cancella la nota salvata.
    await adminPatch(
      new Request(`http://localhost/api/admin/meta-deletion/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect((await listDeletionRequests())[0]?.note).toBe("Nessun account CRM collegato");
  });
});
