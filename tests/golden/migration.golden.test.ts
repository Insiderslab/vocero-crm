import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDb, getSql } from "@/lib/db";
import { sendText } from "@/server/inbox/send";
import { seedDemo } from "@/server/seed/demo";
import { sendTemplate } from "@/server/whatsapp/templates";
import {
  markReconnectRequired,
  saveCredentials,
  setAppDisconnected,
} from "@/server/whatsapp/credentials";
import { runStartup } from "../../scripts/migrate-channels.mjs";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";
import { waFixture } from "./fixtures/whatsapp";
import { conversationIdOf, postWebhook } from "./harness";
import * as r0 from "./legacy/r0-credentials";
import { ORG_A, ORG_B, ORGS } from "./setup";

/**
 * Golden de la migración del livello canali (005, M1.2 R1: T008–T011).
 *
 * Aquí no hay instantáneas: son invariantes con aserciones explícitas sobre
 * PostgreSQL real, con el runner REAL (`scripts/migrate-channels.mjs`).
 *
 * - «R1» = `runStartup` en modo `avvisa` (la constante de este release);
 * - «R2» = el mismo runner en modo `blocca`: es lo que hará la imagen de R2
 *   (M1.3, T032), que no existe todavía;
 * - «R0» = la imagen anterior: sus escrituras se simulan con la copia
 *   congelada de sus funciones (`legacy/r0-credentials.ts`) y, para
 *   contactos, conversaciones y mensajes, con INSERT solo de las columnas
 *   viejas (lo que hace Drizzle con el esquema de R0: las nuevas quedan en su
 *   default). La prueba con la imagen R0 verdadera está en el registro (T020).
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATIONS = path.join(REPO_ROOT, "drizzle");
const ORG_C = "org_golden_c";
const sql = () => getSql();

type Checks = Record<string, number>;

async function legacyCheck(): Promise<Checks> {
  const rows = await sql()<{ verifica: string; anomalie: string }[]>`
    select verifica, anomalie from channels_legacy_check()
  `;
  return Object.fromEntries(rows.map((r) => [r.verifica, Number(r.anomalie)]));
}

const ALL_ZERO = { V1: 0, V2: 0, V3: 0, V4: 0, V5: 0, V6: 0 };

async function startup(mode: "avvisa" | "blocca") {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  const code = await runStartup({
    url: process.env.DATABASE_URL_GOLDEN!,
    migrationsFolder: MIGRATIONS,
    mode,
    log: { log: capture, warn: capture, error: capture },
    attempts: 1,
    retryMs: 10,
  });
  return { code, log: lines.join("\n") };
}

/** Datos como los deja R0 en una base a 0012: solo columnas viejas. */
async function r0Content(org: string, tag: string, opts: { lab?: boolean } = {}) {
  const s = sql();
  await s`
    insert into contact (id, organization_id, wa_identity, phone, name)
    values (${`ct_r0_${tag}_1`}, ${org}, ${`52155${tag}0001`}, ${`52155${tag}0001`}, 'Uno'),
           (${`ct_r0_${tag}_2`}, ${org}, ${`bsuid:MX.${tag}`}, null, 'Dos')
  `;
  await s`
    insert into conversation (id, organization_id, contact_id)
    values (${`cv_r0_${tag}_1`}, ${org}, ${`ct_r0_${tag}_1`}),
           (${`cv_r0_${tag}_2`}, ${org}, ${`ct_r0_${tag}_2`})
  `;
  await s`
    insert into message (id, organization_id, conversation_id, wa_message_id, direction, type, text, status)
    values (${`msg_r0_${tag}_1`}, ${org}, ${`cv_r0_${tag}_1`}, ${`wamid.r0.${tag}.1`}, 'in', 'text', 'hola', 'delivered'),
           (${`msg_r0_${tag}_2`}, ${org}, ${`cv_r0_${tag}_1`}, ${`wamid.r0.${tag}.2`}, 'out', 'text', 'qué tal', 'sent'),
           (${`msg_r0_${tag}_3`}, ${org}, ${`cv_r0_${tag}_2`}, null, 'out', 'text', 'fallido', 'failed')
  `;
  if (opts.lab) {
    await s`
      insert into contact (id, organization_id, wa_identity, phone, name, archived_at)
      values (${`ct_r0_${tag}_lab`}, ${org}, ${`52000${tag}0009`}, ${`52000${tag}0009`}, 'Persona', now())
    `;
    await s`
      insert into conversation (id, organization_id, contact_id, is_test)
      values (${`cv_r0_${tag}_lab`}, ${org}, ${`ct_r0_${tag}_lab`}, true)
    `;
    await s`
      insert into message (id, organization_id, conversation_id, direction, type, text, status)
      values (${`msg_r0_${tag}_lab`}, ${org}, ${`cv_r0_${tag}_lab`}, 'in', 'text', 'prueba', 'delivered')
    `;
  }
}

/** Base «recién migrada a 0013» desde R0: estructuras nuevas vacías. */
async function wipeNewStructures() {
  const s = sql();
  await s`update conversation set channel_account_id = null`;
  await s`update message set external_message_id = null`;
  await s`delete from contact_identity`;
  await s`delete from channel_account`;
}

/**
 * Comparación campo a campo channel_account ↔ meta_credentials, en JS e
 * INDEPENDIENTE de V2 (así un sabotaje de V2 no la esconde).
 */
async function accountMismatches(): Promise<string[]> {
  const rows = await sql()<Record<string, unknown>[]>`
    select mc.id as mc_id, ca.id as ca_id,
           mc.organization_id as mc_org, ca.organization_id as ca_org, ca.channel,
           mc.phone_number_id, ca.external_account_id, mc.waba_id, ca.external_parent_id,
           mc.display_phone_number, ca.display_name, mc.verified_name as mc_verified, ca.verified_name as ca_verified,
           mc.token_cipher, ca.secret_cipher, mc.token_iv, ca.secret_iv, mc.token_tag, ca.secret_tag,
           mc.status as mc_status, ca.status as ca_status,
           mc.onboarding_mode, ca.config,
           mc.app_disconnected_at is not distinct from (ca.config->>'appDisconnectedAt')::timestamp
             as same_disconnected_at
      from meta_credentials mc
      full join channel_account ca on ca.legacy_meta_credentials_id = mc.id
     order by mc.id
  `;
  const out: string[] = [];
  for (const r of rows) {
    const id = String(r.mc_id ?? r.ca_id);
    if (!r.mc_id || !r.ca_id) {
      out.push(`${id}: sin pareja`);
      continue;
    }
    const pairs: [string, unknown, unknown][] = [
      ["organization_id", r.mc_org, r.ca_org],
      ["channel", "whatsapp", r.channel],
      ["phone_number_id", r.phone_number_id, r.external_account_id],
      ["waba_id", r.waba_id, r.external_parent_id],
      ["display", r.display_phone_number, r.display_name],
      ["verified_name", r.mc_verified, r.ca_verified],
      ["token_cipher", r.token_cipher, r.secret_cipher],
      ["token_iv", r.token_iv, r.secret_iv],
      ["token_tag", r.token_tag, r.secret_tag],
      ["status", r.mc_status, r.ca_status],
    ];
    const config = (r.config ?? {}) as { onboardingMode?: unknown };
    pairs.push(["onboarding_mode", r.onboarding_mode, config.onboardingMode]);
    pairs.push(["app_disconnected_at", true, r.same_disconnected_at]);
    for (const [field, a, b] of pairs) {
      if (a !== b) out.push(`${id}.${field}`);
    }
  }
  return out;
}

async function xmins(): Promise<string> {
  const rows = await sql()<{ t: string; id: string; x: string }[]>`
    select 'ca' as t, id, xmin::text as x from channel_account
    union all select 'ci', id, xmin::text from contact_identity
    union all select 'cv', id, xmin::text from conversation
    union all select 'msg', id, xmin::text from message
    order by 1, 2
  `;
  return JSON.stringify(rows);
}

async function dbError(fn: () => Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await fn();
  } catch (err) {
    const e = err as { code?: string; constraint_name?: string };
    return { code: e.code, constraint: e.constraint_name };
  }
  return {};
}

/* ------------------------------------------------------------------ */

describe("migration — T008 riconciliazione su A e B", () => {
  it("ogni conversazione reale punta a un account della SUA organizzazione; contatto e identità uno a uno", async () => {
    await r0Content(ORG_A, "11", { lab: true });
    await r0Content(ORG_B, "22");
    await wipeNewStructures();

    const { code, log } = await startup("avvisa");
    expect(code).toBe(0);
    expect(log).toContain("V1=0 V2=0 V3=0 V4=0 V5=0 V6=0 V7=0");

    const s = sql();
    const conversations = await s<{ id: string; is_test: boolean; org: string; account_org: string | null }[]>`
      select cv.id, cv.is_test, cv.organization_id as org, ca.organization_id as account_org
        from conversation cv left join channel_account ca on ca.id = cv.channel_account_id
       order by cv.id
    `;
    expect(conversations.length).toBe(5);
    for (const cv of conversations) {
      if (cv.is_test) expect(cv.account_org).toBeNull();
      else expect(cv.account_org).toBe(cv.org);
    }

    const identities = await s<{ contact: string; n: number; same: number }[]>`
      select c.id as contact,
             count(ci.id)::int as n,
             count(ci.id) filter (where ci.external_id = c.wa_identity and ci.channel = 'whatsapp'
                                    and ci.organization_id = c.organization_id)::int as same
        from contact c left join contact_identity ci on ci.contact_id = c.id
       group by c.id order by c.id
    `;
    expect(identities.length).toBe(5);
    for (const row of identities) expect([row.contact, row.n, row.same]).toEqual([row.contact, 1, 1]);

    const messages = await s<{ wa: string | null; ext: string | null; channel: string }[]>`
      select wa_message_id as wa, external_message_id as ext, channel from message
    `;
    for (const m of messages) {
      expect(m.ext).toBe(m.wa);
      expect(m.channel).toBe("whatsapp");
    }
    expect(await accountMismatches()).toEqual([]);
  });
});

describe("migration — T009 FK composte", () => {
  it("identità di A con contatto di B → errore del DB", async () => {
    await r0Content(ORG_B, "22");
    const ok = await dbError(() => sql()`
      insert into contact_identity (id, organization_id, contact_id, channel, external_id)
      values ('ci_t009_ok', ${ORG_B}, 'ct_r0_22_1', 'instagram', 'igsid-ok')
    `);
    expect(ok).toEqual({});
    const crossed = await dbError(() => sql()`
      insert into contact_identity (id, organization_id, contact_id, channel, external_id)
      values ('ci_t009_x', ${ORG_A}, 'ct_r0_22_1', 'instagram', 'igsid-x')
    `);
    expect(crossed).toEqual({ code: "23503", constraint: "contact_identity_contact_fk" });
  });

  it("conversazione di A con account di B → errore del DB", async () => {
    await r0Content(ORG_A, "11");
    const [b] = await sql()<{ id: string }[]>`
      select id from channel_account where organization_id = ${ORG_B}
    `;
    const crossed = await dbError(() => sql()`
      update conversation set channel_account_id = ${b!.id} where id = 'cv_r0_11_1'
    `);
    expect(crossed).toEqual({ code: "23503", constraint: "conversation_channel_account_fk" });
  });
});

describe("migration — T010 indici univoci", () => {
  it("UNIQUE (channel, external_account_id): lo stesso phone_number_id in un'altra organizzazione → rifiutato", async () => {
    await sql()`insert into organization (id, name, slug) values (${ORG_C}, 'Negocio Golden C', 'golden-c')`;
    const insertC = (phone: string) => () => sql()`
      insert into channel_account (id, organization_id, channel, external_account_id)
      values ('cha_t010_c', ${ORG_C}, 'whatsapp', ${phone})
    `;
    expect(await dbError(insertC(ORGS.A.phoneNumberId))).toEqual({
      code: "23505",
      constraint: "channel_account_channel_ext_uq",
    });
    expect(await dbError(insertC("100000000000003"))).toEqual({});
  });

  it("UNIQUE (organization_id, channel, external_id): stessa organizzazione → rifiutata; altra organizzazione → ammessa", async () => {
    await r0Content(ORG_A, "11");
    await r0Content(ORG_B, "22");
    const add = (id: string, org: string, contact: string) => () => sql()`
      insert into contact_identity (id, organization_id, contact_id, channel, external_id)
      values (${id}, ${org}, ${contact}, 'instagram', 'igsid-golden-1')
    `;
    expect(await dbError(add("ci_t010_1", ORG_A, "ct_r0_11_1"))).toEqual({});
    expect(await dbError(add("ci_t010_2", ORG_A, "ct_r0_11_2"))).toEqual({
      code: "23505",
      constraint: "contact_identity_org_channel_ext_uq",
    });
    expect(await dbError(add("ci_t010_3", ORG_B, "ct_r0_22_1"))).toEqual({});
  });
});

describe("migration — doppia scrittura (R1, senza riconciliazione)", () => {
  it("credenziali, ingesta, eco, storico, invio: V1–V6 a 0 e account uguali campo per campo senza avviare il runner", async () => {
    // Account: numero e token nuovi, stato, coexistence e taglio (009).
    await saveCredentials({
      organizationId: ORG_A,
      wabaId: ORGS.A.wabaId,
      phoneNumberId: ORGS.A.phoneNumberId,
      token: "EAAGoldenRotatedTokenA0002",
      displayPhoneNumber: ORGS.A.displayPhoneNumber,
      verifiedName: ORGS.A.verifiedName,
      onboardingMode: "coexistence",
    });
    await setAppDisconnected({ wabaId: ORGS.A.wabaId, disconnected: true });
    await markReconnectRequired(ORG_B);
    expect(await accountMismatches()).toEqual([]);
    expect(await legacyCheck()).toEqual(ALL_ZERO);

    // Contatti, conversazioni e messaggi con le funzioni vere di R1.
    await postWebhook(waFixture("inbound-text-mx"));
    await postWebhook(waFixture("inbound-bsuid-only"));
    await postWebhook(waFixture("echo-text"));
    await postWebhook(waFixture("history-two-threads"));
    expect(await legacyCheck()).toEqual(ALL_ZERO);
    const conversationId = await conversationIdOf(ORG_A, "525512345678");
    await sendText({ conversationId, organizationId: ORG_A, text: "hola" });
    await sql()`
      insert into template (id, organization_id, name, language, category, body, status, wa_template_id)
      values ('tpl_golden_mig_a', ${ORG_A}, 'mig_golden', 'es_MX', 'UTILITY', 'Hola {{1}}', 'approved', '7000000000020')
    `;
    await sendTemplate({
      organizationId: ORG_A,
      conversationId,
      templateId: "tpl_golden_mig_a",
      variables: ["Ana"],
    });

    const counts = await sql()<{ contacts: number; messages: number; with_ext: number }[]>`
      select (select count(*)::int from contact) as contacts,
             (select count(*)::int from message) as messages,
             (select count(*)::int from message where external_message_id is not null) as with_ext
    `;
    expect(counts[0]!.contacts).toBeGreaterThan(1);
    expect(counts[0]!.with_ext).toBeGreaterThan(3);
    expect(await legacyCheck()).toEqual(ALL_ZERO);
    expect(await accountMismatches()).toEqual([]);
  });

  it("seed demo: contatti con identità, conversazioni con l'account, messaggi con l'ID esterno", async () => {
    await seedDemo(getDb(), ORG_A);
    const [row] = await sql()<{ n: number }[]>`select count(*)::int as n from contact_identity where organization_id = ${ORG_A}`;
    expect(row!.n).toBeGreaterThan(0);
    expect(await legacyCheck()).toEqual(ALL_ZERO);
  });

  it("organizzazione senza numero che poi si collega: le sue conversazioni prendono l'account nella stessa transazione", async () => {
    await sql()`insert into organization (id, name, slug) values (${ORG_C}, 'Negocio Golden C', 'golden-c')`;
    await r0Content(ORG_C, "33");
    await sql()`delete from contact_identity`; // sin cuenta y sin identidad: luego la reconciliación
    await saveCredentials({
      organizationId: ORG_C,
      wabaId: "200000000000003",
      phoneNumberId: "100000000000003",
      token: "EAAGoldenSyntheticTokenOrgC0003",
    });
    const rows = await sql()<{ n: number }[]>`
      select count(*)::int as n from conversation
       where organization_id = ${ORG_C} and channel_account_id is null
    `;
    expect(rows[0]!.n).toBe(0);
    expect(await accountMismatches()).toEqual([]);
  });
});

describe("migration — T011 riconciliazione all'avvio (runner vero)", () => {
  it("idempotenza: due avvii, nessun duplicato e nessuna riga modificata la seconda volta", async () => {
    await r0Content(ORG_A, "11", { lab: true });
    await r0Content(ORG_B, "22");
    await wipeNewStructures();
    expect((await startup("avvisa")).code).toBe(0);
    const before = await xmins();
    const count = async () =>
      JSON.stringify(await sql()`
        select (select count(*) from channel_account) as accounts,
               (select count(*) from contact_identity) as identities
      `);
    const counts = await count();
    expect(counts).toBe('[{"accounts":"2","identities":"5"}]');
    expect((await startup("avvisa")).code).toBe(0);
    expect(await xmins()).toBe(before);
    expect(await count()).toBe(counts);
  });

  it("aggiornamenti del codice vecchio (numero, token, stato, coexistence, organizzazione nuova, contenuti): V2 > 0 prima; dopo R1 e R2 tutto a 0 e campo per campo", async () => {
    // R1 in esercizio con i suoi dati.
    await r0Content(ORG_A, "11");
    expect((await startup("avvisa")).code).toBe(0);

    // Rollback a R0: le funzioni VECCHIE scrivono e aggiornano.
    await sql()`insert into organization (id, name, slug) values (${ORG_C}, 'Negocio Golden C', 'golden-c')`;
    await r0.saveCredentials({
      organizationId: ORG_A,
      wabaId: ORGS.A.wabaId,
      phoneNumberId: "100000000000091",
      token: "EAAGoldenRotatedByR0TokenA",
      displayPhoneNumber: "+52 55 1000 0091",
      verifiedName: "Golden A nuevo",
      onboardingMode: "coexistence",
    });
    await r0.setAppDisconnected({ wabaId: ORGS.A.wabaId, disconnected: true });
    await r0.markReconnectRequired(ORG_B);
    await r0.saveCredentials({
      organizationId: ORG_C,
      wabaId: "200000000000003",
      phoneNumberId: "100000000000003",
      token: "EAAGoldenSyntheticTokenOrgC0003",
    });
    await r0Content(ORG_B, "22");
    await r0Content(ORG_C, "33");

    // La verifica VE el defecto antes de la reconciliación.
    const pre = await legacyCheck();
    expect(pre.V2).toBeGreaterThan(0);
    expect(pre.V1).toBeGreaterThan(0);
    expect(pre.V3).toBeGreaterThan(0);
    expect(pre.V4).toBeGreaterThan(0);
    expect(pre.V5).toBeGreaterThan(0);

    const r1 = await startup("avvisa");
    expect(r1.code).toBe(0);
    expect(r1.log).toContain("V1=0 V2=0 V3=0 V4=0 V5=0 V6=0 V7=0");
    expect(await accountMismatches()).toEqual([]);
    const r2 = await startup("blocca");
    expect(r2.code).toBe(0);
    expect(await legacyCheck()).toEqual(ALL_ZERO);
    expect(await accountMismatches()).toEqual([]);
  });

  it("numeri scambiati tra A e B dal codice vecchio → riallineati senza violare l'indice univoco", async () => {
    expect((await startup("avvisa")).code).toBe(0);
    // R0 scambia i numeri (passando da un numero temporaneo, come farebbe l'operatore).
    const save = (org: "A" | "B", phoneNumberId: string) =>
      r0.saveCredentials({
        organizationId: ORGS[org].id,
        wabaId: ORGS[org].wabaId,
        phoneNumberId,
        token: ORGS[org].token,
      });
    await save("A", "100000000000099");
    await save("B", ORGS.A.phoneNumberId);
    await save("A", ORGS.B.phoneNumberId);
    expect((await legacyCheck()).V2).toBe(2);

    const r1 = await startup("avvisa");
    expect(r1.code).toBe(0);
    expect(r1.log).toContain("V1=0 V2=0");
    const rows = await sql()<{ org: string; phone: string }[]>`
      select organization_id as org, external_account_id as phone from channel_account order by 1
    `;
    expect(rows).toEqual([
      { org: ORG_A, phone: ORGS.B.phoneNumberId },
      { org: ORG_B, phone: ORGS.A.phoneNumberId },
    ]);
    expect(await accountMismatches()).toEqual([]);
  });

  it("V2 vede un campo copiato alterato a mano", async () => {
    await sql()`update channel_account set display_name = 'alterado' where organization_id = ${ORG_A}`;
    expect((await legacyCheck()).V2).toBe(1);
    await sql()`update channel_account set config = '{"onboardingMode":"embedded","appDisconnectedAt":null}' where organization_id = ${ORG_B}`;
    expect((await legacyCheck()).V2).toBe(2);
  });

  it("ritorno a R2 senza migrazioni pendenti (R2 → R0 → R2): la riconciliazione gira comunque e riallinea", async () => {
    expect((await startup("blocca")).code).toBe(0);
    await r0.saveCredentials({
      organizationId: ORG_B,
      wabaId: ORGS.B.wabaId,
      phoneNumberId: "100000000000092",
      token: "EAAGoldenRotatedByR0TokenB",
    });
    await r0Content(ORG_B, "22");
    const back = await startup("blocca");
    expect(back.code).toBe(0);
    expect(await legacyCheck()).toEqual(ALL_ZERO);
    expect(await accountMismatches()).toEqual([]);
  });

  it("account orfano (meta_credentials cancellata a mano): R2 esce con codice 1 e nomina V1; R1 parte e lo scrive nel log", async () => {
    expect((await startup("avvisa")).code).toBe(0);
    await sql()`delete from meta_credentials where organization_id = ${ORG_B}`;

    const r2 = await startup("blocca");
    expect(r2.code).toBe(1);
    expect(r2.log).toMatch(/verifica fallita[^\n]*V1=1/);

    // R1: la imagen verdadera (scripts/migrate.mjs, modo constante) arranca.
    const run = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "migrate.mjs")], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_GOLDEN, MIGRATIONS_DIR: MIGRATIONS },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.status).toBe(0);
    expect(`${run.stdout}${run.stderr}`).toMatch(/canali \(avvisa\): V1=1/);
    expect(`${run.stdout}${run.stderr}`).toContain("modalità «avvisa»");
  });
});

describe("migration — revisione avversaria (PR #7)", () => {
  it("meta_credentials cancellata e ricreata con un id nuovo (ripristino col codice vecchio) → l'account si riaggancia; il codice nuovo salva e la riconciliazione regge", async () => {
    expect((await startup("avvisa")).code).toBe(0);
    await sql()`delete from meta_credentials where organization_id = ${ORG_B}`;
    await r0.saveCredentials({
      organizationId: ORG_B,
      wabaId: ORGS.B.wabaId,
      phoneNumberId: ORGS.B.phoneNumberId,
      token: ORGS.B.token,
    });
    expect((await legacyCheck()).V1).toBeGreaterThan(0);

    const r1 = await startup("avvisa");
    expect(r1.code).toBe(0);
    expect(await legacyCheck()).toEqual(ALL_ZERO);
    const [row] = await sql()<{ n: string }[]>`
      select count(*)::text as n from channel_account
       where organization_id = ${ORG_B}
         and legacy_meta_credentials_id = (select id from meta_credentials where organization_id = ${ORG_B})
    `;
    expect(row?.n).toBe("1");

    // Il codice nuovo può ricollegare il numero (prima: 23505 su channel_account_channel_ext_uq).
    await saveCredentials({
      organizationId: ORG_B,
      wabaId: ORGS.B.wabaId,
      phoneNumberId: ORGS.B.phoneNumberId,
      token: "EAAGoldenRotatedAfterRecreateB",
    });
    expect(await legacyCheck()).toEqual(ALL_ZERO);
    expect(await accountMismatches()).toEqual([]);
  });

  it("un'identità residua con lo stesso ID esterno NON blocca l'alta di un contatto: la scrittura vecchia vince, V3 lo segnala, l'avvio lo ripara", async () => {
    expect((await startup("avvisa")).code).toBe(0);
    const [other] = await sql()<{ id: string }[]>`
      select id from contact where organization_id = ${ORG_A} order by created_at limit 1
    `;
    let otherId = other?.id;
    if (!otherId) {
      otherId = "ct_golden_other";
      await sql()`insert into contact (id, organization_id, wa_identity, phone, name)
                  values (${otherId}, ${ORG_A}, '5215599990000', '5215599990000', 'Altro')`;
    }
    // Identità "sporca": punta a un altro contatto con l'ID esterno che arriverà.
    await sql()`insert into contact_identity (id, organization_id, contact_id, channel, external_id)
                values ('ci_golden_stale', ${ORG_A}, ${otherId}, 'whatsapp', '5215512340000')`;

    const { contact } = await getOrCreateContactByIdentity(ORG_A, {
      identity: "5215512340000",
      phone: "5215512340000",
      waUserId: null,
      profileName: "Nuovo",
    });
    expect(contact.waIdentity).toBe("5215512340000");
    const [row] = await sql()<{ n: string }[]>`
      select count(*)::text as n from contact where organization_id = ${ORG_A} and wa_identity = '5215512340000'
    `;
    expect(row?.n).toBe("1");
    expect((await legacyCheck()).V3).toBeGreaterThan(0);
  });
});

describe("migration — fase B", () => {
  it("indice INVALID lasciato da un CREATE INDEX CONCURRENTLY interrotto → al riavvio il runner lo elimina e lo ricrea", async () => {
    await r0Content(ORG_A, "11");
    expect((await startup("avvisa")).code).toBe(0);
    const s = sql();
    // Un CONCURRENTLY che fallisce a metà lascia l'indice INVALID.
    await s`drop index message_org_channel_ext_uq`;
    await s`update message set external_message_id = 'wamid.dup' where id in ('msg_r0_11_1', 'msg_r0_11_2')`;
    const failed = await dbError(() =>
      s.unsafe(
        'CREATE UNIQUE INDEX CONCURRENTLY "message_org_channel_ext_uq" ON "message" USING btree ("organization_id","channel","external_message_id")'
      )
    );
    expect(failed.code).toBe("23505");
    const valid = async () =>
      (await s<{ valid: boolean }[]>`
        select i.indisvalid as valid from pg_class c join pg_index i on i.indexrelid = c.oid
         where c.relname = 'message_org_channel_ext_uq'
      `).map((r) => r.valid);
    expect(await valid()).toEqual([false]);

    const run = await startup("avvisa");
    expect(run.code).toBe(0);
    expect(run.log).toContain("V1=0 V2=0 V3=0 V4=0 V5=0 V6=0 V7=0");
    expect(run.log).not.toContain("non completato");
    expect(await valid()).toEqual([true]);
  });
});
