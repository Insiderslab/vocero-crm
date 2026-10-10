import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardarraíl de `/api/settings/**`.
 *
 * Estas rutas cambian o muestran configuración de la organización (conexión
 * de WhatsApp, marca, equipo, claves). Una ruta nueva sin control de rol es
 * exactamente cómo un member acabó pudiendo sustituir la conexión de WhatsApp:
 * nada truena, funciona para el owner. Aquí se exige que CADA handler exportado
 * tenga un control de rol explícito, o figure con su motivo en la lista de
 * excepciones. Si este test se puso rojo, añade el control: no la excepción.
 */

const SETTINGS = path.resolve(import.meta.dirname, "..", "..", "src", "app", "api", "settings");

const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Señales de control de rol: la regla única de roles o la gestión de claves. */
const CONTROL_DE_ROL =
  /withAdminAuth|withOwnerAuth|isOrgAdmin|canManage\w+\(|session\.role|apiKeyCollectionHandlers|apiKeyRevokeHandler/;

/** Excepciones documentadas (ruta relativa a settings : método). */
const EXCEPCIONES: Record<string, string> = {
  "team/route.ts:GET":
    "lista el equipo de la propia organización (nombre, correo, rol); la usa la pantalla de equipo para cualquier miembro",
  "branding/route.ts:GET":
    "público a propósito: el login necesita la marca antes de autenticarse; solo devuelve la marca de la organización de la sesión",
};

/** Devuelve los handlers exportados de un route.ts que NO tienen control de rol. */
export function handlersSinControl(source: string): string[] {
  const sinControl: string[] = [];
  const re = new RegExp(
    `export\\s+(?:const|async\\s+function|function)\\s+(${METODOS.join("|")})\\b`,
    "g"
  );
  const marcas = [...source.matchAll(re)];
  marcas.forEach((m, i) => {
    const fin = marcas[i + 1]?.index ?? source.length;
    const cuerpo = source.slice(m.index, fin);
    // `export const POST = handlers.POST`: el control vive en la fábrica que importa.
    const delegado = /=\s*handlers\.\w+;/.test(cuerpo) && CONTROL_DE_ROL.test(source);
    if (!CONTROL_DE_ROL.test(cuerpo) && !delegado) sinControl.push(m[1] as string);
  });
  return sinControl;
}

function rutas(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return rutas(full);
    return entry === "route.ts" ? [full] : [];
  });
}

describe("guardarraíl: toda ruta de /api/settings controla el rol", () => {
  const archivos = rutas(SETTINGS);

  it("encuentra las rutas (el escáner no está ciego)", () => {
    expect(archivos.length).toBeGreaterThanOrEqual(10);
  });

  it("ningún handler queda sin control de rol, salvo las excepciones documentadas", () => {
    const sueltos: string[] = [];
    for (const file of archivos) {
      const rel = path.relative(SETTINGS, file).split(path.sep).join("/");
      for (const metodo of handlersSinControl(readFileSync(file, "utf8"))) {
        if (!(`${rel}:${metodo}` in EXCEPCIONES)) sueltos.push(`${rel}:${metodo}`);
      }
    }
    expect(sueltos).toEqual([]);
  });

  it("cada excepción sigue existiendo (no quedan excepciones muertas)", () => {
    const reales = new Set<string>();
    for (const file of archivos) {
      const rel = path.relative(SETTINGS, file).split(path.sep).join("/");
      for (const metodo of handlersSinControl(readFileSync(file, "utf8"))) {
        reales.add(`${rel}:${metodo}`);
      }
    }
    expect([...reales].sort()).toEqual(Object.keys(EXCEPCIONES).sort());
  });

  // Sabotaje del propio escáner: si dejara de ver una ruta sin control, el
  // guardarraíl sería decorativo.
  it("sabotaje: detecta una ruta de modificación sin control de rol", () => {
    const sabotada = `
      import { withAuth } from "@/lib/api";
      export const GET = withAuth(async () => Response.json({}));
      export const PUT = withAuth(async (session) => Response.json({ org: session.organizationId }));
    `;
    expect(handlersSinControl(sabotada)).toEqual(["GET", "PUT"]);
  });

  it("detecta la ruta con `export async function` sin control", () => {
    expect(
      handlersSinControl("export async function DELETE() { return new Response(null); }")
    ).toEqual(["DELETE"]);
  });

  it("acepta las rutas con control, con la regla única o delegadas", () => {
    expect(
      handlersSinControl(`export const GET = withAdminAuth(async () => Response.json({}));`)
    ).toEqual([]);
    expect(
      handlersSinControl(
        `const handlers = apiKeyCollectionHandlers("bot");\nexport const GET = handlers.GET;\nexport const POST = handlers.POST;`
      )
    ).toEqual([]);
    expect(
      handlersSinControl(
        `export const POST = withAuth(async (session) => { if (session.role !== "owner") return x; return y; });`
      )
    ).toEqual([]);
  });
});
