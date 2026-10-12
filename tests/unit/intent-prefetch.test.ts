import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createIntentPrefetcher } from "@/lib/intent-prefetch";

/**
 * 009 (E5/E6) — La barra lateral ya no dispara una ráfaga de `?_rsc=` al
 * abrir cada página: precarga un enlace solo con intención (puntero, foco,
 * toque) y una vez por ventana de tiempo.
 */

describe("createIntentPrefetcher", () => {
  it("una precarga por enlace dentro de la ventana; después, otra", () => {
    let clock = 0;
    const calls: string[] = [];
    const go = createIntentPrefetcher((h) => calls.push(h), 30_000, () => clock);
    go("/pipeline");
    go("/pipeline");
    go("/lab");
    clock = 29_999;
    go("/pipeline");
    clock = 30_000;
    go("/pipeline");
    expect(calls).toEqual(["/pipeline", "/lab", "/pipeline"]);
  });

  it("un prefetch que lanza no rompe la página", () => {
    const go = createIntentPrefetcher(() => {
      throw new Error("sin router");
    });
    expect(() => go("/inbox")).not.toThrow();
  });
});

describe("barra lateral (vigilancia del código)", () => {
  const src = readFileSync(
    path.resolve(import.meta.dirname, "..", "..", "src", "components", "app-nav.tsx"),
    "utf8"
  );

  it("todo <Link> del lateral usa la precarga por intención (sin prefetch en ráfaga)", () => {
    const links = src.match(/<Link\b/g) ?? [];
    const withIntent = src.match(/<Link\b[^>]*?\{\.\.\.intent\(/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(withIntent.length).toBe(links.length);
    expect(src).toMatch(/prefetch: false as const/);
  });
});

describe("listas con un enlace por fila: sin prefetch", () => {
  const read = (...p: string[]) =>
    readFileSync(path.resolve(import.meta.dirname, "..", "..", "src", ...p), "utf8");

  it.each([
    ["components/pipeline/pipeline-client.tsx"],
    ["components/pipeline/lead-drawer.tsx"],
    ["components/contacts/contacts-client.tsx"],
  ])("%s: los enlaces por lead/contacto no precargan", (file) => {
    const src = read(file);
    const perRow = [...src.matchAll(/<Link\b[\s\S]*?>/g)].map((m) => m[0]).filter((tag) =>
      tag.includes("/inbox?contact=")
    );
    expect(perRow.length).toBeGreaterThan(0);
    for (const tag of perRow) expect(tag).toContain("prefetch={false}");
  });
});
