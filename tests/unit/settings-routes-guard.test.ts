import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guardCumple, POLICY_IMPL, ROUTE_ROLES, SETTINGS_EXCEPCIONES } from "./helpers/route-roles";
import { scanHandlers, type Guard } from "./helpers/route-scan";

/**
 * Guardarraíl de roles de TODA la API (`src/app/api/**`).
 *
 * Una ruta que cambia la configuración de la organización o habla con Meta sin
 * control de rol es exactamente cómo un member acabó pudiendo sustituir la
 * conexión de WhatsApp o crear plantillas: nada truena, funciona para el
 * owner. Aquí:
 *  1. el inventario `helpers/route-roles.ts` lista cada handler con su política
 *     (una ruta o método nuevo sin entrada rompe el test);
 *  2. el escáner lee el AST de cada `route.ts` y comprueba que la función que
 *     de verdad envuelve al handler (y el módulo del que viene) es la de esa
 *     política. NO se mira texto: `session.role` en un JSON, el nombre de la
 *     guardia en un comentario o una guardia local con el mismo nombre no
 *     cuentan (ver los sabotajes del propio escáner, abajo);
 *  3. dentro de `settings/**` solo `member`/`public` las excepciones
 *     documentadas;
 *  4. la prueba de comportamiento (member → 403 sin tocar BD ni Meta) vive en
 *     `route-roles-behavior.test.ts`.
 * Si este test se puso rojo, añade el control (`withAdminAuth`/`withOwnerAuth`):
 * no la excepción.
 */

const API = path.resolve(import.meta.dirname, "..", "..", "src", "app", "api");

function rutas(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return rutas(full);
    return entry === "route.ts" ? [full] : [];
  });
}

/** Todos los ficheros `route.*` bajo src/app/api (Next sirve también .tsx/.js/.jsx/.mjs). */
function ficherosRoute(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return ficherosRoute(full);
    return /^route\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry) ? [full] : [];
  });
}

const rel = (file: string) => path.relative(API, path.dirname(file)).split(path.sep).join("/");

/** Handlers reales: clave "ruta:MÉTODO" → guard leído del AST. */
function handlersReales(): Record<string, Guard> {
  const out: Record<string, Guard> = {};
  for (const file of rutas(API)) {
    for (const [metodo, guard] of Object.entries(scanHandlers(readFileSync(file, "utf8")))) {
      out[`${rel(file)}:${metodo}`] = guard;
    }
  }
  return out;
}

/** Lee el handler de otro `route.ts` para los `export { X } from "./otra"`. */
function alReexportar(desde: string) {
  return (from: string, as: string): Guard | undefined => {
    const destino = path.resolve(API, desde, "..", `${from}.ts`);
    return scanHandlers(readFileSync(destino, "utf8"))[as];
  };
}

describe("inventario de rutas de /api", () => {
  const reales = handlersReales();

  it("el escáner encuentra las rutas (no está ciego)", () => {
    expect(Object.keys(reales).length).toBeGreaterThanOrEqual(80);
    expect(Object.keys(reales)).toContain("settings/whatsapp:PUT");
    expect(Object.keys(reales)).toContain("templates:POST");
  });

  it("cada handler exportado figura en el inventario", () => {
    const sinClasificar = Object.keys(reales).filter((k) => !(k in ROUTE_ROLES));
    expect(sinClasificar).toEqual([]);
  });

  it("cada entrada del inventario sigue existiendo (sin entradas muertas)", () => {
    const muertas = Object.keys(ROUTE_ROLES).filter((k) => !(k in reales));
    expect(muertas).toEqual([]);
  });

  it("la función que protege cada handler es la de su política", () => {
    const incumplen: string[] = [];
    for (const [key, entry] of Object.entries(ROUTE_ROLES)) {
      const guard = reales[key];
      if (!guard) continue; // lo cubre el test de entradas muertas
      if (!guardCumple(guard, entry.policy, alReexportar(entry.file + "/route"))) {
        const impl = POLICY_IMPL[entry.policy];
        incumplen.push(
          `${key}: política "${entry.policy}" (${impl ? `${impl.name} de ${impl.module}` : "sin guardia"}), pero el handler es ${JSON.stringify(guard)}`
        );
      }
    }
    expect(incumplen).toEqual([]);
  });
});

describe("settings/**: nada queda abierto salvo las excepciones documentadas", () => {
  it("todo handler de settings es admin u owner, o está en la lista de excepciones", () => {
    const abiertos = Object.values(ROUTE_ROLES)
      .filter((e) => e.file.startsWith("settings/"))
      .filter((e) => e.policy !== "admin" && e.policy !== "owner")
      .map((e) => `${e.file}:${e.method}`)
      .sort();
    expect(abiertos).toEqual([...SETTINGS_EXCEPCIONES].sort());
  });

  it("las excepciones tienen un motivo escrito", () => {
    for (const key of SETTINGS_EXCEPCIONES) {
      expect(ROUTE_ROLES[key]?.why).toMatch(/^EXCEPCIÓN: .{20,}/);
    }
  });
});

describe("rutas con efecto sobre la configuración o Meta: owner/admin", () => {
  // Las que este guardarraíl no deja abrir: si alguien las baja a `member`
  // en el inventario, este test es el que lo señala y obliga a justificarlo.
  const SENSIBLES = [
    "settings/whatsapp:GET",
    "settings/whatsapp:PUT",
    "settings/whatsapp/test:POST",
    "settings/webhook:GET",
    "templates:POST",
    "templates/sync:POST",
    "agent/profile:PUT",
    "automations:POST",
    "automations/[id]:PATCH",
    "automations/[id]:DELETE",
    "automations/run:POST",
    "kb:POST",
    "kb/[id]:PATCH",
    "kb/[id]:DELETE",
    "lab/runs:POST",
    "lab/suggestions/apply:POST",
    "seed/demo:POST",
  ];

  it.each(SENSIBLES)("%s exige owner/admin", (key) => {
    expect(["admin", "owner"]).toContain(ROUTE_ROLES[key]?.policy);
  });
});

// Sabotaje del propio escáner: si dejara pasar estas formas, el guardarraíl
// sería decorativo. Son los rodeos que el escáner por texto no veía.
describe("sabotaje del escáner: los rodeos no cuentan como control", () => {
  const imp = `import { withAuth, withAdminAuth } from "@/lib/api";\n`;
  const guardia = (src: string, metodo = "PUT") => scanHandlers(src)[metodo];
  const cumple = (src: string, policy: "admin" | "owner" | "member", metodo = "PUT") => {
    const g = guardia(src, metodo);
    return g ? guardCumple(g, policy, () => undefined) : false;
  };

  it("control real: withAdminAuth importado de @/lib/api", () => {
    expect(cumple(`${imp}export const PUT = withAdminAuth(async () => Response.json({}));`, "admin")).toBe(true);
  });

  it("session.role devuelto en el JSON no es un control", () => {
    const src = `${imp}export const PUT = withAuth(async (session) => Response.json({ role: session.role }));`;
    expect(cumple(src, "admin")).toBe(false);
    expect(cumple(src, "member")).toBe(true); // es un handler de miembro, ni más ni menos
  });

  it("session.role dentro de un if tampoco sustituye a la guardia única", () => {
    const src = `${imp}export const PUT = withAuth(async (session) => { if (session.role !== "owner") return x; return y; });`;
    expect(cumple(src, "admin")).toBe(false);
    expect(cumple(src, "owner")).toBe(false);
  });

  it("el nombre de la guardia en un comentario o en una cadena no cuenta", () => {
    const enComentario = `${imp}export const PUT = withAuth(async () => { /* TODO withAdminAuth */ return y; });`;
    const enCadena = `${imp}export const PUT = withAuth(async () => Response.json({ guard: "withAdminAuth(" }));`;
    expect(cumple(enComentario, "admin")).toBe(false);
    expect(cumple(enCadena, "admin")).toBe(false);
  });

  it("forma de lista `export { PUT }` se lee igual que `export const`", () => {
    expect(cumple(`${imp}const PUT = withAuth(async () => y);\nexport { PUT };`, "admin")).toBe(false);
    expect(cumple(`${imp}const PUT = withAdminAuth(async () => y);\nexport { PUT };`, "admin")).toBe(true);
    expect(scanHandlers(`${imp}const h = withAuth(async () => y);\nexport { h as DELETE };`).DELETE).toMatchObject({
      kind: "wrapper",
      name: "withAuth",
    });
  });

  it("`export const PUT = handlers.PUT` no se acepta por un control en otra parte del archivo", () => {
    const src = `${imp}const handlers = fabrica();\nexport const GET = withAdminAuth(async () => y);\nexport const PUT = handlers.PUT;`;
    expect(guardia(src, "GET")).toMatchObject({ kind: "wrapper", name: "withAdminAuth" });
    expect(guardia(src, "PUT")?.kind).toBe("unresolved");
    expect(cumple(src, "admin", "PUT")).toBe(false);
  });

  it("importar withAuth con el alias withAdminAuth no engaña: manda el nombre original", () => {
    const src = `import { withAuth as withAdminAuth } from "@/lib/api";\nexport const PUT = withAdminAuth(async () => y);`;
    expect(guardia(src)).toMatchObject({ kind: "wrapper", name: "withAuth", module: "@/lib/api" });
    expect(cumple(src, "admin")).toBe(false);
  });

  it("una guardia local con el mismo nombre no es la de @/lib/api", () => {
    const src = `const withAdminAuth = (h) => h;\nexport const PUT = withAdminAuth(async () => y);`;
    expect(guardia(src)?.kind).toBe("unresolved");
    expect(cumple(src, "admin")).toBe(false);
  });

  it("la guardia importada de otro módulo no cuenta", () => {
    const src = `import { withAdminAuth } from "./falsa";\nexport const PUT = withAdminAuth(async () => y);`;
    expect(cumple(src, "admin")).toBe(false);
  });

  it("una función propia sin guardia (`export async function`) no cumple admin", () => {
    const src = `export async function PUT() { return new Response(null); }`;
    expect(guardia(src)).toMatchObject({ kind: "body", calls: [] });
    expect(cumple(src, "admin")).toBe(false);
  });

  it("una política de llamada exige llamar de verdad a la función de su módulo", () => {
    const ok = `import { authenticateBot } from "@/server/bot/auth";\nexport async function POST(req) { const a = await authenticateBot(req); return y; }`;
    const falso = `export async function POST(req) { const authenticateBot = 1; /* authenticateBot(req) */ return y; }`;
    const g = (src: string) => scanHandlers(src).POST as Guard;
    expect(guardCumple(g(ok), "bot-key", () => undefined)).toBe(true);
    expect(guardCumple(g(falso), "bot-key", () => undefined)).toBe(false);
  });

  it("`public` no acepta un handler que ya lleva una guardia conocida", () => {
    const src = `${imp}export const PUT = withAdminAuth(async () => y);`;
    expect(guardCumple(guardia(src) as Guard, "public", () => undefined)).toBe(false);
  });

  it("`export const { GET } = x` y `export * from` no se aceptan: no se sabe qué protege", () => {
    const desestructurado = scanHandlers(`const handlers = fabrica();\nexport const { GET, POST } = handlers;`);
    expect(desestructurado.GET?.kind).toBe("unresolved");
    expect(desestructurado.POST?.kind).toBe("unresolved");
    expect(scanHandlers(`export * from "./otra";`)["*"]?.kind).toBe("unresolved");
    // y por eso un archivo así hace fallar el inventario: "*" no figura en él.
    expect("*" in ROUTE_ROLES).toBe(false);
  });

  it("un re-export se resuelve leyendo el otro archivo, y si no se puede leer falla", () => {
    const g = scanHandlers(`export { POST } from "./otra";`).POST as Guard;
    expect(g.kind).toBe("reexport");
    const conGuard = scanHandlers(
      `import { mockGuard } from "@/lib/dev-guard";\nexport async function POST() { const g = mockGuard(); return g; }`
    ).POST;
    expect(guardCumple(g, "dev-mock", () => conGuard)).toBe(true);
    expect(guardCumple(g, "dev-mock", () => undefined)).toBe(false);
  });
});

describe("ninguna ruta escapa al inventario por la extensión", () => {
  it("todos los route handlers de /api son route.ts (el escáner solo lee esos)", () => {
    const otros = ficherosRoute(API).filter((f) => path.basename(f) !== "route.ts");
    expect(otros.map((f) => path.relative(API, f))).toEqual([]);
  });
});
