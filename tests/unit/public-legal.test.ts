import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Pagine pubbliche (privacy, termini, cancellazione dati): devono rendere
 * senza sessione e senza database, nelle tre lingue, e nessun controllo di
 * accesso deve poterle bloccare (le legge il verificatore di Meta).
 */

const state = vi.hoisted(() => ({ locale: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "heili-locale" && state.locale ? { value: state.locale } : undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));
// Se una pagina pubblica provasse a leggere la sessione o il database, salta.
vi.mock("@/lib/auth/session", () => ({
  getSessionOrNull: async () => {
    throw new Error("la pagina pubblica ha letto la sessione");
  },
}));
vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("la pagina pubblica ha toccato il database");
  },
  schema: {},
}));

import PublicLayout from "@/app/(public)/layout";
import PrivacyPage from "@/app/(public)/privacy/page";
import TermsPage from "@/app/(public)/termini/page";
import DeletionPage from "@/app/(public)/cancellazione-dati/page";
import { LegalPage, legalMetadata } from "@/components/legal/legal-page";
import { messagesFor } from "@/lib/i18n/messages";
import { LOCALES } from "@/lib/i18n";
import {
  fillLegal,
  LEGAL_EMAIL_PLACEHOLDER,
  LEGAL_ENTITY_PLACEHOLDER,
  LEGAL_PATHS,
  legalContext,
  type LegalKind,
} from "@/lib/legal";

const ROOT = path.resolve(import.meta.dirname, "../..");
const KINDS: LegalKind[] = ["privacy", "terms", "deletion"];
const PAGES = {
  privacy: PrivacyPage,
  terms: TermsPage,
  deletion: DeletionPage,
} as const;


function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Import vietati in un file pubblico: sessione, auth, database, logica server. */
function forbiddenImports(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = m[1]!;
    if (
      /^@\/server(\/|$)/.test(spec) ||
      /^@\/lib\/(auth|db|crypto|env|meta)(\/|$)/.test(spec) ||
      /^better-auth/.test(spec) ||
      /^drizzle-orm/.test(spec) ||
      /^postgres$/.test(spec)
    )
      found.push(spec);
  }
  return found;
}

describe("testi legali: stessa forma in tutte le lingue", () => {
  for (const kind of KINDS) {
    it(`${kind}: sezioni, elenchi e segnaposto coincidono tra es, en e it`, () => {
      const shape = (l: (typeof LOCALES)[number]) =>
        messagesFor(l).legal[kind].sections.map((s) => [s.body.length, s.list.length]);
      expect(shape("en")).toEqual(shape("es"));
      expect(shape("it")).toEqual(shape("es"));
      const holders = (l: (typeof LOCALES)[number]) =>
        JSON.stringify(messagesFor(l).legal[kind]).match(/\{\{\w+\}\}/g)?.length;
      expect(holders("en")).toBe(holders("es"));
      expect(holders("it")).toBe(holders("es"));
    });
  }

  it("ogni testo ha solo segnaposto noti e nessuna stringa vuota", () => {
    for (const l of LOCALES) {
      const text = JSON.stringify(messagesFor(l).legal);
      for (const m of text.matchAll(/\{\{(\w+)\}\}/g))
        expect(["product", "entity", "email"]).toContain(m[1]);
      expect(text).not.toContain('""');
    }
  });

  it("la cancellazione dati indica un contatto, un tempo e una procedura", () => {
    for (const l of LOCALES) {
      const text = JSON.stringify(messagesFor(l).legal.deletion);
      expect(text).toContain("{{email}}");
      expect(text).toContain("30");
    }
  });

  it("nessun testo contiene segreti, domini reali o indirizzi inventati", () => {
    for (const l of LOCALES) {
      const text = JSON.stringify(messagesFor(l).legal);
      expect(text).not.toMatch(/https?:\/\//);
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(text).not.toMatch(/sk-or-|EAA[A-Za-z0-9]{10,}/);
    }
  });
});

describe("legalContext e fillLegal", () => {
  it("senza variabili mostra segnaposto evidenti, non nomi inventati", () => {
    const ctx = legalContext({});
    expect(ctx.entity).toBe(LEGAL_ENTITY_PLACEHOLDER);
    expect(ctx.email).toBe(LEGAL_EMAIL_PLACEHOLDER);
    expect(legalContext({ LEGAL_ENTITY_NAME: "  ", LEGAL_CONTACT_EMAIL: "" })).toEqual(ctx);
  });

  it("usa i dati del titolare dall'ambiente", () => {
    const ctx = legalContext({
      LEGAL_ENTITY_NAME: " Esempio S.r.l. ",
      LEGAL_CONTACT_EMAIL: "privacy@esempio.test",
    });
    expect(ctx.entity).toBe("Esempio S.r.l.");
    expect(fillLegal("{{entity}} / {{email}} / {{product}}", ctx)).toBe(
      "Esempio S.r.l. / privacy@esempio.test / Heili CRM"
    );
  });

  it("un segnaposto ignoto resta com'è (niente prototipi: {{constructor}})", () => {
    const ctx = legalContext({});
    expect(fillLegal("{{constructor}} {{x}}", ctx)).toBe("{{constructor}} {{x}}");
  });
});

describe("pagine pubbliche senza sessione", () => {
  beforeEach(() => {
    state.locale = undefined;
  });

  for (const l of LOCALES) {
    for (const kind of KINDS) {
      it(`${kind} in ${l}: rende, con titolo, segnaposto del titolare e nota nel guscio`, async () => {
        state.locale = l;
        const legal = messagesFor(l).legal;
        const shell = renderToStaticMarkup(
          await PublicLayout({ children: createElement("span", { id: "slot" }) })
        );
        expect(shell).toContain(`href="${LEGAL_PATHS.privacy}"`);
        expect(shell).toContain(`href="${LEGAL_PATHS.terms}"`);
        expect(shell).toContain(`href="${LEGAL_PATHS.deletion}"`);
        expect(shell).toContain(legal.chrome.privacy);
        const html = renderToStaticMarkup(await LegalPage({ kind }));
        expect(html).toContain(`<h1`);
        expect(html).toContain(legal[kind].title.replace(/'/g, "&#x27;"));
        expect(html).toContain(LEGAL_EMAIL_PLACEHOLDER);
        expect(html).not.toContain("{{");
      });
    }
  }

  it("ogni pagina monta il testo del proprio tipo e i metadati", async () => {
    state.locale = "en";
    for (const kind of KINDS) {
      const element = PAGES[kind]() as React.ReactElement<{ kind: string }>;
      expect(element.props.kind).toBe(kind);
      const meta = await legalMetadata(kind);
      expect(String(meta.title)).toContain(messagesFor("en").legal[kind].title);
      expect(String(meta.description)).not.toContain("{{");
    }
  });

  it("senza cookie la lingua è quella predefinita (italiano)", async () => {
    const html = renderToStaticMarkup(await LegalPage({ kind: "privacy" }));
    expect(html).toContain(messagesFor("it").legal.privacy.title);
  });

  it("un cookie di lingua manipolato non rompe la pagina", async () => {
    state.locale = "../../etc/passwd";
    const html = renderToStaticMarkup(await LegalPage({ kind: "terms" }));
    expect(html).toContain(messagesFor("it").legal.terms.title.replace(/'/g, "&#x27;"));
  });
});

describe("nessun controllo di accesso blocca le pagine pubbliche", () => {
  it("non esiste un middleware che protegga il sito", () => {
    for (const f of ["src/middleware.ts", "src/proxy.ts", "middleware.ts", "proxy.ts"])
      expect(existsSync(path.join(ROOT, f)), f).toBe(false);
  });

  it("ogni percorso legale ha la sua pagina nel gruppo (public)", () => {
    for (const kind of KINDS) {
      const file = path.join(ROOT, "src/app/(public)", LEGAL_PATHS[kind], "page.tsx");
      expect(existsSync(file), file).toBe(true);
    }
  });

  it("i percorsi pubblici non cadono sotto le sezioni protette né sotto /api", () => {
    const protectedSegments = readdirSync(path.join(ROOT, "src/app/(app)"));
    const authSegments = readdirSync(path.join(ROOT, "src/app/(auth)"));
    for (const kind of KINDS) {
      const seg = LEGAL_PATHS[kind].split("/")[1]!;
      expect(protectedSegments).not.toContain(seg);
      expect(authSegments).not.toContain(seg);
      expect(seg).not.toBe("api");
    }
  });

  it("solo il gruppo (app) esige la sessione: il guscio pubblico no", () => {
    const appLayout = readFileSync(path.join(ROOT, "src/app/(app)/layout.tsx"), "utf8");
    expect(appLayout).toMatch(/redirect\("\/login"\)/);
    const publicLayout = readFileSync(path.join(ROOT, "src/app/(public)/layout.tsx"), "utf8");
    expect(publicLayout).not.toMatch(/redirect\(/);
    expect(publicLayout).not.toMatch(/getSessionOrNull|getSession/);
  });

  it("i file pubblici non importano sessione, auth, database né logica server", () => {
    const files = [
      ...walk(path.join(ROOT, "src/app/(public)")),
      ...walk(path.join(ROOT, "src/components/legal")),
      path.join(ROOT, "src/lib/legal.ts"),
      ...LOCALES.map((l) => path.join(ROOT, `src/lib/i18n/messages/${l}/legal.ts`)),
    ];
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const f of files) expect(forbiddenImports(readFileSync(f, "utf8")), f).toEqual([]);
  });

  it("sabotaggio: la guardia degli import riconosce un import vietato", () => {
    expect(forbiddenImports('import { getDb } from "@/lib/db";')).toEqual(["@/lib/db"]);
    expect(forbiddenImports('import { x } from "@/server/branding";')).toEqual(["@/server/branding"]);
    expect(forbiddenImports('import { getAuth } from "@/lib/auth/session";')).toEqual([
      "@/lib/auth/session",
    ]);
    expect(forbiddenImports('import Link from "next/link";')).toEqual([]);
  });
});
