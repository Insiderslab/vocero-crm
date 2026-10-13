import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES } from "@/lib/i18n";
import { messagesFor } from "@/lib/i18n/messages";
import { translate } from "@/lib/i18n/t";

/**
 * E9 — La pestaña enseñaba `meta.titleSuffix`: el layout pedía una llave que
 * no existe (vive en `common.meta`). `translate` devuelve la llave cruda
 * cuando no la encuentra —a propósito, para no tronar—, así que el error no
 * se ve en ningún typecheck. Este test recorre el código y exige que TODA
 * llave literal `t("…")` exista en los tres idiomas.
 */

const ROOT = path.resolve(import.meta.dirname, "../../src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      // Los diccionarios no llaman a t().
      if (p.endsWith(path.join("i18n", "messages"))) continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const LITERAL_KEY = /\bt\(\s*"([A-Za-z0-9_.]+)"/g;

function literalKeys(): { file: string; key: string }[] {
  const found: { file: string; key: string }[] = [];
  for (const file of sourceFiles(ROOT)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(LITERAL_KEY)) {
      found.push({ file: path.relative(ROOT, file), key: m[1]! });
    }
  }
  return found;
}

describe("i18n: las llaves literales existen", () => {
  const keys = literalKeys();

  it("encuentra llaves (el recorrido no está vacío)", () => {
    expect(keys.length).toBeGreaterThan(200);
  });

  it.each(LOCALES)("toda llave t(\"…\") del código se resuelve en %s", (locale) => {
    const dict = messagesFor(locale) as Record<string, unknown>;
    const missing = keys
      .filter(({ key }) => translate(dict, key) === key)
      .map(({ file, key }) => `${file}: ${key}`);
    expect(missing).toEqual([]);
  });

  it("el título de la pestaña ya no es la llave cruda (E9)", () => {
    const layout = readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
    expect(layout).toContain('t("common.meta.titleSuffix")');
    for (const locale of LOCALES) {
      const dict = messagesFor(locale) as Record<string, unknown>;
      expect(translate(dict, "common.meta.titleSuffix")).not.toBe(
        "common.meta.titleSuffix"
      );
    }
  });
});
