#!/usr/bin/env node
/**
 * Coordinamento tra Claude Code, Codex e OpenCode (docs/COORDINAMENTO-AGENTI.md).
 * Ogni pacchetto dichiara il proprio perimetro in `.coordinamento/pacchetti/<id>.json` sul proprio
 * branch; questo script legge le dichiarazioni di tutti i branch remoti e trova i conflitti.
 * Nessuna dipendenza: lo stesso file vive in ogni repository (versione sotto).
 *
 *   node scripts/coordina.mjs stato [--json]   bacheca di tutti i pacchetti attivi
 *   node scripts/coordina.mjs verifica         controlla il branch corrente (uscita 1 se c'è un problema)
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const VERSIONE = 2;
export const CARTELLA = ".coordinamento/pacchetti/";
// Scrivono codice da unire claude, codex e opencode; kimi, deepseek e muse lavorano su branch propri (GUIDA-HEILI §3).
const STRUMENTI = { "claude/": "claude", "codex/": "codex", "opencode/": "opencode", "kimi/": "kimi", "deepseek/": "deepseek", "muse/": "muse" };
const STATI = new Set(["in-corso", "in-revisione", "bloccato"]);
const GIORNI_FERMO = 7;

/** Strumento che può scrivere su un branch, dal prefisso; `null` = branch di nessuno dei tre. */
export function strumentoDelBranch(branch) {
  const prefisso = Object.keys(STRUMENTI).find((p) => branch.startsWith(p));
  return prefisso ? STRUMENTI[prefisso] : null;
}

/** Errori di forma di una dichiarazione (lista vuota = valida). */
export function validaDichiarazione(d, branch) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return ["la dichiarazione non è un oggetto JSON"];
  const errori = [];
  if (typeof d.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,60}$/.test(d.id)) errori.push("id: minuscole, cifre e trattini (3-61 caratteri)");
  if (typeof d.titolo !== "string" || !d.titolo.trim()) errori.push("titolo mancante");
  if (!Object.values(STRUMENTI).includes(d.strumento)) errori.push(`strumento: uno tra ${Object.values(STRUMENTI).join(", ")}`);
  else if (strumentoDelBranch(branch) !== d.strumento) errori.push(`il branch ${branch} non appartiene a ${d.strumento}`);
  if (d.branch !== branch) errori.push(`branch dichiarato (${d.branch}) diverso dal branch reale (${branch})`);
  if (!Array.isArray(d.file) || d.file.length === 0 || !d.file.every((f) => typeof f === "string" && f && !f.startsWith("/") && !f.includes(".."))) {
    errori.push("file: elenco non vuoto di percorsi relativi (una cartella finisce con /)");
  }
  if (!STATI.has(d.stato)) errori.push("stato: in-corso, in-revisione oppure bloccato");
  if (typeof d.aggiornato !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.aggiornato)) errori.push("aggiornato: data AAAA-MM-GG");
  return errori;
}

/** `voce` copre `percorso` se è lo stesso file o una cartella (finisce con /) che lo contiene. */
export function copre(voce, percorso) {
  return voce === percorso || (voce.endsWith("/") && percorso.startsWith(voce));
}

/** Due perimetri si toccano se una voce dell'uno copre una voce dell'altro. */
export function sovrapposizione(a, b) {
  return a.flatMap((x) => b.filter((y) => copre(x, y) || copre(y, x)).map((y) => (copre(x, y) ? y : x)));
}

/** Coppie di pacchetti attivi che dichiarano gli stessi file. */
export function conflitti(pacchetti) {
  const trovati = [];
  for (let i = 0; i < pacchetti.length; i++) {
    for (let j = i + 1; j < pacchetti.length; j++) {
      const comuni = sovrapposizione(pacchetti[i].file, pacchetti[j].file);
      if (comuni.length) trovati.push({ a: pacchetti[i].id, b: pacchetti[j].id, file: [...new Set(comuni)] });
    }
  }
  return trovati;
}

/** File cambiati dal branch che il suo perimetro non copre (la cartella .coordinamento/ è sempre ammessa). */
export function fuoriPerimetro(cambiati, perimetro) {
  return cambiati.filter((f) => !f.startsWith(".coordinamento/") && !perimetro.some((v) => copre(v, f)));
}

/** Un pacchetto è fermo se la dichiarazione non è aggiornata da più di GIORNI_FERMO giorni. */
export function fermo(d, oggi = new Date()) {
  return (oggi.getTime() - Date.parse(`${d.aggiornato}T00:00:00Z`)) / 86_400_000 > GIORNI_FERMO;
}

// --- Git ----------------------------------------------------------------------------------------

const esegui = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
// Sempre dalla radice del repository: i percorsi delle dichiarazioni e dei diff sono relativi a lei (Approve vive in heili-approve/).
let radice;
const git = (...args) => esegui((radice ??= esegui(process.cwd(), ["rev-parse", "--show-toplevel"])), args);
const righe = (testo) => testo.split("\n").filter(Boolean);

/** Il ramo principale scritto in `.coordinamento/principale` (prima riga), oppure `null` se il testo non è un nome di branch. */
export function nomePrincipale(testo) {
  const nome = String(testo ?? "").split("\n")[0].trim();
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(nome) && !nome.includes("..") ? nome : null;
}

function ramoPrincipale() {
  // Un repository il cui lavoro confluisce in un ramo diverso da main (es. Approve) lo dichiara qui.
  try {
    const nome = nomePrincipale(readFileSync(join(git("rev-parse", "--show-toplevel"), ".coordinamento", "principale"), "utf8"));
    if (nome) { git("rev-parse", "--verify", "--quiet", `origin/${nome}`); return `origin/${nome}`; }
  } catch {}
  try { return git("symbolic-ref", "--short", "refs/remotes/origin/HEAD"); } catch {}
  for (const r of ["origin/main", "origin/master"]) {
    try { git("rev-parse", "--verify", "--quiet", r); return r; } catch {}
  }
  throw new Error("ramo principale non trovato (origin/main o origin/master)");
}

function dichiarazioniIn(ref) {
  let nomi;
  try { nomi = righe(git("ls-tree", "--name-only", ref, CARTELLA)); } catch { return []; }
  return nomi.filter((n) => n.endsWith(".json")).map((nome) => {
    try { return { nome, dati: JSON.parse(git("show", `${ref}:${nome}`)) }; }
    catch { return { nome, dati: null }; }
  });
}

/** Il lavoro del branch è già sul ramo principale: nessun commit avanti, o (squash) i suoi file sono identici. */
function giaIntegrato(ref, principale) {
  if (git("rev-list", "--count", `${principale}..${ref}`) === "0") return true;
  let toccati;
  // Un branch senza storia in comune (es. il README del profilo) non è integrato: niente merge base, niente diff.
  try { toccati = righe(git("diff", "--name-only", `${principale}...${ref}`)); } catch { return false; }
  try { git("diff", "--quiet", principale, ref, "--", ...toccati); return true; } catch { return false; }
}

/** Pacchetti attivi: dichiarati su un branch remoto e non ancora arrivati sul ramo principale. */
export function leggiBacheca() {
  const principale = ramoPrincipale();
  const conclusi = new Set(dichiarazioniIn(principale).map((d) => d.dati?.id).filter(Boolean));
  const pacchetti = [];
  const problemi = [];
  const senzaDichiarazione = [];
  let vecchiSenzaDichiarazione = 0;
  for (const ref of righe(git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/"))) {
    const branch = ref.slice("origin/".length);
    if (ref === principale || branch === "HEAD" || ref === "origin") continue;
    const dichiarazioni = dichiarazioniIn(ref).filter((d) => !conclusi.has(d.dati?.id));
    if (dichiarazioni.length === 0) {
      if (!strumentoDelBranch(branch) || giaIntegrato(ref, principale)) continue;
      // I branch uniti con squash restano "avanti" a main: oltre 14 giorni di silenzio si contano soltanto.
      if (Date.now() / 1000 - Number(git("log", "-1", "--format=%ct", ref)) > 2 * GIORNI_FERMO * 86_400) vecchiSenzaDichiarazione++;
      else senzaDichiarazione.push(branch);
      continue;
    }
    for (const { nome, dati } of dichiarazioni) {
      const errori = validaDichiarazione(dati, branch);
      if (errori.length) problemi.push({ branch, file: nome, errori });
      else pacchetti.push({ ...dati, fermo: fermo(dati), ultimoCommit: git("log", "-1", "--format=%cs", ref) });
    }
  }
  return { versione: VERSIONE, principale, pacchetti, conflitti: conflitti(pacchetti), problemi, senzaDichiarazione, vecchiSenzaDichiarazione };
}

function verifica() {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const bacheca = leggiBacheca();
  if (`origin/${branch}` === bacheca.principale) return console.log("Ramo principale: niente da verificare."), 0;
  const mie = dichiarazioniIn("HEAD").map((d) => d.dati).filter((d) => d && d.branch === branch);
  if (mie.length !== 1) return console.error(`Serve una sola dichiarazione in ${CARTELLA} con branch "${branch}" (trovate ${mie.length}).`), 1;
  const mia = mie[0];
  const errori = validaDichiarazione(mia, branch);
  const cambiati = righe(git("diff", "--name-only", `${bacheca.principale}...HEAD`));
  const fuori = fuoriPerimetro(cambiati, mia.file);
  const altrui = conflitti([mia, ...bacheca.pacchetti.filter((p) => p.id !== mia.id)]).filter((c) => c.a === mia.id);
  for (const e of errori) console.error(`Dichiarazione: ${e}`);
  for (const f of fuori) console.error(`Fuori perimetro: ${f}`);
  for (const c of altrui) console.error(`Conflitto con ${c.b}: ${c.file.join(", ")}`);
  if (errori.length || fuori.length || altrui.length) return 1;
  console.log(`OK: ${mia.id} (${mia.strumento}) tocca solo il suo perimetro e nessun altro pacchetto attivo lo dichiara.`);
  return 0;
}

function stampaStato(bacheca) {
  console.log(`Bacheca (rispetto a ${bacheca.principale})`);
  if (!bacheca.pacchetti.length) console.log("  nessun pacchetto attivo");
  for (const p of bacheca.pacchetti) {
    console.log(`  ${p.strumento.padEnd(8)} ${p.id} — ${p.titolo} [${p.stato}${p.fermo ? ", FERMO" : ""}] ${p.branch}`);
  }
  for (const c of bacheca.conflitti) console.log(`  CONFLITTO ${c.a} ↔ ${c.b}: ${c.file.join(", ")}`);
  for (const p of bacheca.problemi) console.log(`  DICHIARAZIONE NON VALIDA ${p.branch} ${p.file}: ${p.errori.join("; ")}`);
  for (const b of bacheca.senzaDichiarazione) console.log(`  SENZA DICHIARAZIONE ${b}`);
  if (bacheca.vecchiSenzaDichiarazione) console.log(`  (${bacheca.vecchiSenzaDichiarazione} branch senza dichiarazione fermi da più di 14 giorni)`);
}

function main(argv) {
  const [comando, ...opzioni] = argv;
  if (comando === "stato") {
    const bacheca = leggiBacheca();
    if (opzioni.includes("--json")) console.log(JSON.stringify(bacheca, null, 2));
    else stampaStato(bacheca);
    return bacheca.conflitti.length || bacheca.problemi.length ? 1 : 0;
  }
  if (comando === "verifica") return verifica();
  console.error("Uso: node scripts/coordina.mjs stato [--json] | verifica");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv.slice(2));
