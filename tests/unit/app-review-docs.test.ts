import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Il materiale per l'App Review (docs/meta/app-review/) non deve contenere
 * segreti né domini reali: solo segnaposto tra <...>.
 */

const DIR = path.resolve(import.meta.dirname, "../../docs/meta/app-review");

/** Cose che non devono mai finire in questi documenti. */
function leaks(text: string): string[] {
  const found: string[] = [];
  if (/\bEAA[A-Za-z0-9]{20,}/.test(text)) found.push("token Meta");
  if (/sk-or-[A-Za-z0-9-]{10,}/.test(text)) found.push("chiave OpenRouter");
  if (/\b[0-9a-f]{32}\b/.test(text)) found.push("segreto esadecimale (32)");
  if (/(secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9+/_-]{16,}/i.test(text))
    found.push("assegnazione di segreto");
  for (const m of text.matchAll(/https?:\/\/([^\s/`)<>|]+)/g)) {
    const host = m[1]!;
    if (!/^(localhost|example\.(com|org|test))$/.test(host)) found.push(`dominio ${host}`);
  }
  return found;
}

describe("docs/meta/app-review", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".md"));

  it("ci sono i cinque documenti attesi", () => {
    expect(files.sort()).toEqual([
      "README.md",
      "checklist-tech-provider-embedded-signup-v4.md",
      "copioni-video.md",
      "note-permessi.md",
      "valori-pannello-meta.md",
    ]);
  });

  it("nessun segreto né dominio reale: solo segnaposto", () => {
    for (const f of files)
      expect(leaks(readFileSync(path.join(DIR, f), "utf8")), f).toEqual([]);
  });

  it("i valori del pannello usano il segnaposto di dominio", () => {
    const text = readFileSync(path.join(DIR, "valori-pannello-meta.md"), "utf8");
    for (const p of ["/privacy", "/termini", "/cancellazione-dati"])
      expect(text).toContain(`https://<CRM_DOMAIN>${p}`);
  });

  it("citano i permessi e la versione v4 con la data di ritiro", () => {
    const all = files.map((f) => readFileSync(path.join(DIR, f), "utf8")).join("\n");
    for (const p of [
      "whatsapp_business_management",
      "whatsapp_business_messaging",
      "instagram_business_basic",
      "instagram_business_manage_messages",
      "pages_messaging",
    ])
      expect(all).toContain(p);
    expect(all).toContain("15/10/2026");
    expect(all).toMatch(/v4/);
  });

  it("sabotaggio: la guardia riconosce token, chiavi e domini veri", () => {
    expect(leaks("EAAGm0PX4ZCpsBAKZCsample1234567890abcdef")).toContain("token Meta");
    expect(leaks("sk-or-v1-abcdefghijklmnop")).toContain("chiave OpenRouter");
    expect(leaks("verify_token = abcdefghijklmnop1234")).toContain("assegnazione di segreto");
    expect(leaks("https://crm.cliente-vero.it/privacy")).toContain("dominio crm.cliente-vero.it");
    expect(leaks("https://<CRM_DOMAIN>/privacy")).toEqual([]);
  });
});

/**
 * Le note per permesso non devono dichiarare come esistenti funzioni che non
 * esistono ancora (Embedded Signup, Instagram, Messenger, Pagine Facebook):
 * la sezione che le cita deve avere «in arrivo» nel titolo.
 */
const NOT_YET = /embedded signup|instagram|messenger|facebook (page|login)|pagine facebook/i;

/** Titoli delle sezioni che citano una funzione non ancora esistente senza marcarla. */
function unmarkedSections(markdown: string): string[] {
  const out: string[] = [];
  let heading = "(inizio)";
  let body: string[] = [];
  const flush = () => {
    if (NOT_YET.test(body.join("\n")) && !/in arrivo/i.test(heading)) out.push(heading);
  };
  for (const line of markdown.split("\n")) {
    if (/^#{1,6}\s/.test(line)) {
      flush();
      heading = line;
      body = [];
    } else body.push(line);
  }
  flush();
  return out;
}

describe("note-permessi.md: solo funzioni presenti o marcate «in arrivo»", () => {
  const text = readFileSync(path.join(DIR, "note-permessi.md"), "utf8");

  it("ogni sezione che cita funzioni non ancora costruite e' marcata in arrivo", () => {
    expect(unmarkedSections(text)).toEqual([]);
  });

  it("le sezioni dei permessi dipendenti da K2/K3/K4 portano il marcatore", () => {
    for (const perm of [
      "whatsapp_business_management",
      "whatsapp_business_messaging",
      "instagram_business_basic",
      "instagram_business_manage_messages",
      "pages_show_list",
      "pages_manage_metadata",
      "pages_messaging",
    ]) {
      const m = new RegExp(`^###\\s+\`${perm}\`.*$`, "m").exec(text);
      expect(m, perm).not.toBeNull();
      expect(m![0], perm).toMatch(/in arrivo/i);
    }
  });

  it("esiste una descrizione del prodotto di oggi senza Instagram ne' Messenger", () => {
    const section = text.split(/^## /m).find((s) => s.startsWith("Descrizione comune del prodotto, versione di oggi"));
    expect(section).toBeDefined();
    expect(section).not.toMatch(NOT_YET);
  });

  it("sabotaggio: la guardia accusa una sezione non marcata e accetta quella marcata", () => {
    expect(unmarkedSections("### `x`\nUses Instagram to read DMs.")).toEqual(["### `x`"]);
    expect(unmarkedSections("### `x` [IN ARRIVO]\nUses Instagram to read DMs.")).toEqual([]);
    expect(unmarkedSections("### `x`\nUses Embedded Signup.")).toHaveLength(1);
    expect(unmarkedSections("### `x`\nReads WhatsApp templates.")).toEqual([]);
  });
});

