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
