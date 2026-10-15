import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { getSql } from "@/lib/db";
import { ChannelMirrorError } from "@/server/channels/dual-write";
import { getCredentialsByOrg, saveCredentials } from "@/server/whatsapp/credentials";
import { runStartup } from "../../scripts/migrate-channels.mjs";
import { waFixture } from "./fixtures/whatsapp";
import { postWebhook } from "./harness";
import { ORG_A, ORG_B, ORGS } from "./setup";

/**
 * 005-livello-canali (M1.3, R2) — Correzioni della revisione avversaria della
 * PR #14. Asserzioni esplicite, nessuna istantanea.
 *
 * 1. copia STRETTA `meta_credentials` → `channel_account` (niente SAVEPOINT,
 *    postcondizione V1/V2 sulle righe scritte): scenario cross-organizzazione
 *    del revisore e guasto transitorio della copia;
 * 3. il runner in «blocca» ritenta riconciliazione+verifiche su un lock
 *    transitorio prima di uscire con 1;
 * 5. lo stato di un modello per WABA vale per OGNI organizzazione della WABA.
 */

const sql = () => getSql();
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATIONS = path.join(REPO_ROOT, "drizzle");

const consoleErrorLines = () =>
  vi.mocked(console.error).mock.calls.map((c) => c.map(String).join(" "));

async function mcRow(org: string) {
  const [row] = await sql()<{ phone_number_id: string; token_cipher: string; app_disconnected_at: unknown }[]>`
    select phone_number_id, token_cipher, app_disconnected_at from meta_credentials where organization_id = ${org}
  `;
  return row;
}

/** Guasto transitorio della copia: la funzione SQL sparisce per la durata di `fn`. */
async function withMirrorFunctionMissing(fn: () => Promise<void>) {
  await sql()`alter function channels_legacy_sync_accounts(text[]) rename to channels_legacy_sync_accounts_off`;
  try {
    await fn();
  } finally {
    await sql()`alter function channels_legacy_sync_accounts_off(text[]) rename to channels_legacy_sync_accounts`;
  }
}

describe("revisione PR #14 — copia stretta degli account", () => {
  it("scenario del revisore: meta_credentials di A cancellata a mano, B salva il vecchio numero di A → il salvataggio FALLISCE visibilmente e nessun webhook va a B", async () => {
    const bBefore = await mcRow(ORG_B);
    await sql()`delete from meta_credentials where organization_id = ${ORG_A}`;

    const err = await saveCredentials({
      organizationId: ORG_B,
      wabaId: ORGS.B.wabaId,
      phoneNumberId: ORGS.A.phoneNumberId,
      token: ORGS.B.token,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChannelMirrorError);
    expect(consoleErrorLines().some((l) => l.includes("channel_account") && l.includes("se deshace"))).toBe(true);
    // Niente è cambiato: né la riga vecchia di B né la sua vista.
    expect(await mcRow(ORG_B)).toEqual(bBefore);
    expect((await getCredentialsByOrg(ORG_B))?.phoneNumberId).toBe(ORGS.B.phoneNumberId);

    // Il numero (ex) di A non entra mai in B; quello di B continua a entrare in B.
    await postWebhook(waFixture("inbound-text-mx"));
    await postWebhook(waFixture("inbound-text-b"));
    const inB = await sql()<{ external_message_id: string }[]>`
      select external_message_id from message where organization_id = ${ORG_B} order by external_message_id
    `;
    // Solo il messaggio arrivato al numero di B; quello al numero ex di A no.
    expect(inB.map((r) => r.external_message_id)).not.toContain("wamid.golden.in.text.1");
    expect(inB).toHaveLength(1);
  });

  it("organizzazione nuova C salva il numero ancora nell'account orfano di A: il passo (1c) lo scarterebbe in silenzio, la postcondizione lo rifiuta", async () => {
    await sql()`delete from meta_credentials where organization_id = ${ORG_A}`;
    await sql()`insert into organization (id, name, slug) values ('org_golden_c', 'Negocio Golden C', 'golden-c')`;
    const err = await saveCredentials({
      organizationId: "org_golden_c",
      wabaId: "200000000000003",
      phoneNumberId: ORGS.A.phoneNumberId,
      token: "EAAGoldenSyntheticTokenOrgC0003",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChannelMirrorError);
    expect(String((err as Error).message)).toContain("V1/V2");
    const [c] = await sql()<{ n: number }[]>`
      select (select count(*)::int from meta_credentials where organization_id = 'org_golden_c')
           + (select count(*)::int from channel_account where organization_id = 'org_golden_c') as n
    `;
    expect(c?.n).toBe(0);
  });

  it("guasto transitorio della copia: il salvataggio fallisce e annulla ANCHE la scrittura di meta_credentials", async () => {
    const before = await mcRow(ORG_A);
    await withMirrorFunctionMissing(async () => {
      const err = await saveCredentials({
        organizationId: ORG_A,
        wabaId: ORGS.A.wabaId,
        phoneNumberId: ORGS.A.phoneNumberId,
        token: "EAAGoldenRotatedTokenThatMustNotStick",
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ChannelMirrorError);
    });
    expect(await mcRow(ORG_A)).toEqual(before);
    expect((await getCredentialsByOrg(ORG_A))?.token).toBe(ORGS.A.token);
  });

  it("account_update con la copia in errore: il webhook risponde 200, il corte NON si registra (nemmeno su meta_credentials) e il log lo dice", async () => {
    await saveCredentials({
      organizationId: ORG_A,
      wabaId: ORGS.A.wabaId,
      phoneNumberId: ORGS.A.phoneNumberId,
      token: ORGS.A.token,
      displayPhoneNumber: ORGS.A.displayPhoneNumber,
      verifiedName: ORGS.A.verifiedName,
      onboardingMode: "coexistence",
    });
    await withMirrorFunctionMissing(async () => {
      const res = await postWebhook(waFixture("account-update-partner-removed-a"));
      expect(res.status).toBe(200);
    });
    expect((await mcRow(ORG_A))?.app_disconnected_at).toBeNull();
    expect((await getCredentialsByOrg(ORG_A))?.appDisconnectedAt).toBeNull();
    expect(consoleErrorLines().some((l) => l.includes("account_update PARTNER_REMOVED"))).toBe(true);

    // Copia di nuovo disponibile: lo stesso evento ora si registra.
    await postWebhook(waFixture("account-update-partner-removed-a"));
    expect((await getCredentialsByOrg(ORG_A))?.appDisconnectedAt).not.toBeNull();
  });
});

describe("revisione PR #14 — stato del modello per WABA condivisa", () => {
  it("A e B sulla stessa WABA: l'evento APPROVED approva il modello in ENTRAMBE", async () => {
    await saveCredentials({
      organizationId: ORG_B,
      wabaId: ORGS.A.wabaId,
      phoneNumberId: ORGS.B.phoneNumberId,
      token: ORGS.B.token,
    });
    await sql()`
      insert into template (id, organization_id, name, language, category, body, status)
      values ('tpl_golden_promo_a', ${ORG_A}, 'promo_golden', 'es_MX', 'MARKETING', 'Hola {{1}}', 'pending'),
             ('tpl_golden_promo_b', ${ORG_B}, 'promo_golden', 'es_MX', 'MARKETING', 'Hola {{1}}', 'pending')
    `;
    await postWebhook(waFixture("template-status-approved")); // entry.id = WABA di A
    const rows = await sql()<{ organization_id: string; status: string }[]>`
      select organization_id, status from template order by organization_id
    `;
    expect(rows).toEqual([
      { organization_id: ORG_A, status: "approved" },
      { organization_id: ORG_B, status: "approved" },
    ]);
  });
});

describe("revisione PR #14 — il runner in «blocca» ritenta", () => {
  async function startup(opts: { delays: number[] }) {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    const code = await runStartup({
      url: process.env.DATABASE_URL_GOLDEN!,
      migrationsFolder: MIGRATIONS,
      mode: "blocca",
      log: { log: capture, warn: capture, error: capture },
      attempts: 1,
      retryMs: 10,
      checkRetryDelaysMs: opts.delays,
      lockTimeout: "200ms",
    });
    return { code, log: lines.join("\n") };
  }

  /** Lock esclusivo su channel_account tenuto da un'altra sessione per `ms`. */
  async function holdLock(ms: number) {
    let locked!: () => void;
    const ready = new Promise<void>((r) => (locked = r));
    const done = sql().begin(async (tx) => {
      await tx`lock table channel_account in access exclusive mode`;
      locked();
      await sleep(ms);
    });
    await ready;
    return done;
  }

  it("lock transitorio: il primo tentativo fallisce, il secondo riesce → exit 0", async () => {
    const held = holdLock(700);
    const run = await startup({ delays: [900, 900] });
    await held;
    expect(run.code).toBe(0);
    expect(run.log).toMatch(/tentativo 1\/3 non riuscito/);
    expect(run.log).toContain("V1=0 V2=0 V3=0 V4=0 V5=0 V6=0 V7=0");
  });

  it("lock che non finisce entro i tentativi → exit 1 e il log nomina la riconciliazione", async () => {
    const held = holdLock(2500);
    const run = await startup({ delays: [100, 100] });
    await held;
    expect(run.code).toBe(1);
    expect(run.log).toMatch(/tentativo 2\/3 non riuscito/);
    expect(run.log).toMatch(/verifica fallita[^\n]*riconciliazione/);
  });
});
