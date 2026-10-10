/**
 * 005-livello-canali (M1.2, R1) — Avvio del database con il livello canali
 * (ADR 0001 §3.3). Lo chiama `scripts/migrate.mjs` (bundle della
 * immagine, Dockerfile) prima di `node server.js`.
 *
 * Passi, in quest'ordine:
 *   1. se le funzioni `channels_legacy_*` esistono già: riconciliazione +
 *      verifiche (serve a R3: le verifiche girano PRIMA di una migrazione che
 *      toglie le colonne vecchie);
 *   2. migrazioni Drizzle (fase A, una transazione, `lock_timeout` 5 s);
 *   3. fase B: passi online idempotenti, uno per istruzione, FUORI
 *      transazione, `lock_timeout` 5 s (indici CONCURRENTLY, FK, VALIDATE);
 *      un indice lasciato INVALID da un CONCURRENTLY interrotto si elimina e
 *      si ricrea;
 *   4. fase C: riconciliazione (account, identità, conversazioni; messaggi a
 *      lotti in autocommit) + verifiche V1–V6 (`channels_legacy_check()`) e
 *      V7 (`wapi_credentials` invariata dall'inizio alla fine).
 *
 * La riconciliazione NON dipende dal registro delle migrazioni: gira a ogni
 * avvio e riallinea anche ciò che un'immagine vecchia (R0) ha scritto o
 * AGGIORNATO durante un rollback.
 *
 * Modalità (costante del rilascio, mai una variabile d'ambiente):
 *   - "avvisa" (R1): anomalie ed errori di fasi B/C vanno nel log (solo
 *     conteggi, mai valori) e il container parte, perché R1 legge ancora le
 *     colonne vecchie;
 *   - "blocca" (R2, R3): una verifica ≠ 0, o un errore delle fasi B/C → codice
 *     1, il container non parte.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Modalità di QUESTO rilascio (R1). R2 la cambia in "blocca" nel codice. */
export const RELEASE_MODE = "avvisa";

/** Messaggi per lotto della fase C (ADR §3.3: un lotto = una transazione breve). */
export const MESSAGE_BATCH = 5000;

/** Chiave dell'advisory lock: due container che partono insieme non si pestano. */
const STARTUP_LOCK_KEY = 5_005_001;

const LOCK_TIMEOUT = "5s";

/**
 * Fase B: gli oggetti che `schema.ts` dichiara ma che drizzle/0013 NON crea,
 * perché su una tabella esistente prenderebbero lock lunghi dentro la
 * transazione di Drizzle. Ogni passo è idempotente.
 */
export const PHASE_B = [
  {
    kind: "index",
    name: "contact_org_id_uq",
    sql: 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "contact_org_id_uq" ON "contact" USING btree ("organization_id","id")',
  },
  {
    // contact_identity può già avere righe (un avvio precedente interrotto
    // dopo la fase C): NOT VALID + VALIDATE non blocca le scritture su contact.
    kind: "constraint",
    table: "contact_identity",
    name: "contact_identity_contact_fk",
    sql: 'ALTER TABLE "contact_identity" ADD CONSTRAINT "contact_identity_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contact"("organization_id","id") ON DELETE cascade ON UPDATE no action NOT VALID',
  },
  { kind: "validate", table: "contact_identity", name: "contact_identity_contact_fk" },
  {
    kind: "index",
    name: "message_org_channel_ext_uq",
    sql: 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "message_org_channel_ext_uq" ON "message" USING btree ("organization_id","channel","external_message_id")',
  },
  { kind: "validate", table: "message", name: "message_channel_ck" },
  { kind: "validate", table: "conversation", name: "conversation_channel_account_fk" },
];

const noopLog = { log() {}, warn() {}, error() {} };

/**
 * Esegue i passi 1–4. Restituisce il codice d'uscita del processo (0 = il
 * server può partire).
 *
 * @param {object} opts
 * @param {string} opts.url DATABASE_URL
 * @param {string} opts.migrationsFolder cartella `drizzle/`
 * @param {"avvisa"|"blocca"} opts.mode modalità del rilascio
 * @param {Pick<Console,"log"|"warn"|"error">} [opts.log]
 * @param {number} [opts.attempts] tentativi per DB non pronta o lock (oggi 15 × 2 s)
 * @param {number} [opts.retryMs]
 */
export async function runStartup({
  url,
  migrationsFolder,
  mode,
  log = console,
  attempts = 15,
  retryMs = 2000,
}) {
  if (mode !== "avvisa" && mode !== "blocca") {
    throw new Error(`[migrate] modalità sconosciuta: ${mode}`);
  }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const code = await startupOnce(sql, { migrationsFolder, mode, log, retryMs });
      await sql.end();
      return code;
    } catch (err) {
      await sql.end().catch(() => {});
      if (attempt === attempts) {
        log.error("[migrate] falló tras varios intentos:", err);
        return 1;
      }
      log.log(
        `[migrate] BD no lista (intento ${attempt}/${attempts}), reintento en ${retryMs / 1000}s…`
      );
      await sleep(retryMs);
    }
  }
  return 1;
}

/**
 * Un tentativo completo. Le eccezioni (BD non pronta, lock della fase A)
 * risalgono e `runStartup` ritenta, come il runner di prima.
 */
async function startupOnce(sql, { migrationsFolder, mode, log, retryMs }) {
  await acquireStartupLock(sql, log);
  const timings = {};
  const wapiBefore = await readWapiState(sql);

  // Passo 1 — prima delle migrazioni, se il livello canali c'è già.
  if (await channelFunctionsExist(sql)) {
    const pre = await reconcileAndCheck(sql, { log, timings, prefix: "pre" });
    if (mode === "blocca" && !pre.ok) {
      reportFailure(log, "prima delle migrazioni", pre);
      return 1;
    }
  }

  // Passo 2 — Drizzle (fase A). Un errore qui risale: si ritenta.
  let t = Date.now();
  await migrate(drizzle(sql), { migrationsFolder });
  timings.faseA_ms = Date.now() - t;
  log.log("[migrate] migraciones aplicadas");

  if (!(await channelFunctionsExist(sql))) {
    // Cartella di migrazioni senza il livello canali: niente da fare.
    return 0;
  }

  // Passo 3 — fase B.
  t = Date.now();
  const phaseB = await runPhaseB(sql, { log, retryMs });
  timings.faseB_ms = Date.now() - t;

  // Passo 4 — fase C + V7.
  const post = await reconcileAndCheck(sql, { log, timings, prefix: "post" });
  const wapiAfter = await readWapiState(sql);
  const v7 = diffCount(wapiBefore, wapiAfter);
  post.checks.V7 = v7;
  if (v7 !== 0) post.ok = false;
  if (phaseB.failed.length > 0) post.ok = false;

  log.log(
    `[migrate] canali (${mode}): ` +
      Object.entries(post.checks)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ") +
      ` | ${Object.entries(timings)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")}`
  );
  if (!post.ok) {
    reportFailure(log, "dopo le migrazioni", { ...post, phaseB: phaseB.failed });
    if (mode === "blocca") return 1;
    log.warn(
      "[migrate] canali: modalità «avvisa» (R1) — il server parte comunque: R1 legge ancora le colonne vecchie"
    );
  }
  return 0;
}

/** Passi 1 e 4: riconciliazione + V1–V6. In «avvisa» un errore non risale. */
export async function reconcileAndCheck(sql, { log = noopLog, timings = {}, prefix = "" } = {}) {
  const result = { ok: true, errors: [], checks: {} };
  try {
    let t = Date.now();
    await sql`select channels_legacy_sync()`;
    timings[`${prefix}_sync_ms`] = Date.now() - t;

    t = Date.now();
    let after = null;
    let batches = 0;
    for (;;) {
      const [row] = await sql`
        select channels_legacy_sync_messages(${after}, ${MESSAGE_BATCH}) as last
      `;
      if (!row?.last) break;
      after = row.last;
      batches += 1;
    }
    timings[`${prefix}_sync_messages_ms`] = Date.now() - t;
    timings[`${prefix}_batches`] = batches;
  } catch (err) {
    result.ok = false;
    result.errors.push(`riconciliazione: ${describeError(err)}`);
  }
  try {
    const t = Date.now();
    const rows = await sql`select verifica, anomalie from channels_legacy_check()`;
    timings[`${prefix}_check_ms`] = Date.now() - t;
    for (const r of rows) {
      result.checks[r.verifica] = Number(r.anomalie);
      if (Number(r.anomalie) !== 0) result.ok = false;
    }
  } catch (err) {
    result.ok = false;
    result.errors.push(`verifiche: ${describeError(err)}`);
  }
  if (!result.ok) {
    log.warn(
      `[migrate] canali (${prefix}): ` +
        [
          ...Object.entries(result.checks)
            .filter(([, v]) => v !== 0)
            .map(([k, v]) => `${k}=${v} anomalie`),
          ...result.errors,
        ].join("; ")
    );
  }
  return result;
}

/** Fase B, un passo per volta, fuori transazione. */
export async function runPhaseB(sql, { log = noopLog, retryMs = 2000, steps = PHASE_B, tries = 3 } = {}) {
  const failed = [];
  await sql.unsafe(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
  try {
    for (const step of steps) {
      let lastErr = null;
      for (let i = 1; i <= tries; i++) {
        try {
          await applyPhaseBStep(sql, step);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (i < tries) await sleep(retryMs);
        }
      }
      if (lastErr) {
        failed.push(step.name);
        log.warn(`[migrate] fase B: «${step.name}» non completato: ${describeError(lastErr)}`);
      }
    }
  } finally {
    await sql.unsafe("RESET lock_timeout");
  }
  return { failed };
}

async function applyPhaseBStep(sql, step) {
  if (step.kind === "index") {
    const [idx] = await sql`
      select i.indisvalid as valid
        from pg_class c join pg_index i on i.indexrelid = c.oid
       where c.relname = ${step.name} and c.relnamespace = 'public'::regnamespace
    `;
    if (idx?.valid) return;
    if (idx && !idx.valid) {
      // CONCURRENTLY interrotto: l'indice resta INVALID e IF NOT EXISTS lo
      // salterebbe. Si elimina (anch'esso senza bloccare) e si ricrea.
      await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS "public"."${step.name}"`);
    }
    await sql.unsafe(step.sql);
    return;
  }
  const [con] = await sql`
    select convalidated from pg_constraint
     where conname = ${step.name} and conrelid = to_regclass(${`public.${step.table}`})
  `;
  if (step.kind === "constraint") {
    if (!con) await sql.unsafe(step.sql);
    return;
  }
  // validate
  if (!con) throw new Error(`vincolo ${step.name} assente`);
  if (!con.convalidated) {
    await sql.unsafe(`ALTER TABLE "${step.table}" VALIDATE CONSTRAINT "${step.name}"`);
  }
}

async function channelFunctionsExist(sql) {
  const [row] = await sql`
    select to_regprocedure('channels_legacy_sync()') is not null
       and to_regprocedure('channels_legacy_check()') is not null as ok
  `;
  return Boolean(row?.ok);
}

/** V7: (organization_id, key_last4, revoked_at) di wapi_credentials, ordinati. */
async function readWapiState(sql) {
  const [exists] = await sql`select to_regclass('public.wapi_credentials') is not null as ok`;
  if (!exists?.ok) return [];
  const rows = await sql`
    select organization_id, key_last4, revoked_at
      from wapi_credentials order by organization_id, id
  `;
  return rows.map((r) =>
    JSON.stringify([r.organization_id, r.key_last4, r.revoked_at?.toISOString?.() ?? null])
  );
}

function diffCount(before, after) {
  const a = new Map();
  for (const k of before) a.set(k, (a.get(k) ?? 0) + 1);
  for (const k of after) a.set(k, (a.get(k) ?? 0) - 1);
  let n = 0;
  for (const v of a.values()) n += Math.abs(v);
  return n;
}

async function acquireStartupLock(sql, log) {
  // pg_try_advisory_lock in un ciclo (non pg_advisory_lock): chi aspetta non
  // tiene aperta un'istruzione, e un CREATE INDEX CONCURRENTLY dell'altro
  // container non resta in attesa di lui. Il lock vale per la sessione e si
  // libera chiudendo la connessione.
  for (let i = 0; i < 600; i++) {
    const [row] = await sql`select pg_try_advisory_lock(${STARTUP_LOCK_KEY}) as ok`;
    if (row?.ok) return;
    if (i === 0) log.log("[migrate] un altro avvio sta migrando: attendo…");
    await sleep(1000);
  }
  throw new Error("lock di avvio non ottenuto in 10 minuti");
}

function reportFailure(log, when, result) {
  const parts = [
    ...Object.entries(result.checks ?? {})
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${k}=${v}`),
    ...(result.errors ?? []),
    ...(result.phaseB?.length ? [`fase B incompleta: ${result.phaseB.join(", ")}`] : []),
  ];
  log.error(`[migrate] canali: verifica fallita ${when}: ${parts.join("; ")}`);
}

/** Messaggio dell'errore senza parametri né valori delle righe. */
function describeError(err) {
  if (err && typeof err === "object") {
    const code = "code" in err && err.code ? `${err.code} ` : "";
    const message = "message" in err ? String(err.message) : String(err);
    return `${code}${message}`;
  }
  return String(err);
}
