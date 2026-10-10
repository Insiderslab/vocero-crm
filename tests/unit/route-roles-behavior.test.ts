import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { ROUTE_ROLES } from "./helpers/route-roles";

/**
 * Prueba de COMPORTAMIENTO de la política de roles, no de texto: cada handler
 * `admin`/`owner` del inventario se importa y se ejecuta de verdad con
 * sesiones de cada rol. Un rol que no corresponde recibe 403 sin que se llegue
 * a la base de datos, a Meta ni a leer el body; el que corresponde pasa la
 * guardia (el handler se ejecuta: aquí acaba en 500 porque la BD es un doble
 * que revienta, y eso es justo lo que se quiere ver: el control dejó pasar).
 * Complementa al guardarraíl por AST: aquel prueba QUÉ guardia lleva cada
 * handler; este, que la guardia efectiva corta.
 */

const state = vi.hoisted(() => ({
  session: null as { userId: string; organizationId: string; role: string } | null,
  dbCalls: 0,
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireSession: async () => {
      if (!state.session) throw new actual.UnauthorizedError();
      return state.session;
    },
  };
});

// Cualquier acceso a la base de datos cuenta y revienta: un member nunca debe llegar aquí.
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => {
      state.dbCalls += 1;
      throw new Error("BD no disponible en este test");
    },
  };
});

const ruta = (file: string) =>
  path.resolve(import.meta.dirname, "..", "..", "src", "app", "api", file, "route.ts");

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const entradas = Object.values(ROUTE_ROLES).filter(
  (e) => e.policy === "admin" || e.policy === "owner"
);

const METODOS_CON_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function ejecutar(file: string, method: string): Promise<{ res: Response; bodyLeido: boolean }> {
  const mod = (await import(/* @vite-ignore */ ruta(file))) as Record<string, Handler>;
  const handler = mod[method];
  if (typeof handler !== "function") throw new Error(`${file}:${method} no exporta el handler`);
  let bodyLeido = false;
  const req = new Request("http://localhost/api/x", {
    method,
    headers: { "content-type": "application/json" },
    ...(METODOS_CON_BODY.has(method) ? { body: JSON.stringify({}) } : {}),
  });
  for (const leer of ["json", "text", "arrayBuffer", "formData"] as const) {
    const original = req[leer].bind(req);
    (req as unknown as Record<string, unknown>)[leer] = async () => {
      bodyLeido = true;
      return original();
    };
  }
  const res = await handler(req, { params: Promise.resolve({ id: "x", orgId: "x" }) });
  return { res, bodyLeido };
}

const sesion = (role: string) => ({ userId: "u_1", organizationId: "org_a", role });

const FETCH = vi.fn();

beforeEach(() => {
  state.session = null;
  state.dbCalls = 0;
  FETCH.mockReset();
  vi.stubGlobal("fetch", FETCH);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("hay handlers admin/owner que probar", () => {
  it("el inventario no está vacío (la prueba no es decorativa)", () => {
    expect(entradas.length).toBeGreaterThanOrEqual(25);
  });
});

describe.each(entradas.map((e) => [`${e.method} /api/${e.file}`, e] as const))("%s", (_n, e) => {
  const permitidos = e.policy === "owner" ? ["owner"] : ["owner", "admin"];
  const denegados =
    e.policy === "owner"
      ? ["admin", "member", "", "Owner", "viewer", "superadmin"]
      : ["member", "", "Owner", "ADMIN", "viewer", "superadmin"];

  it.each(denegados)("rol %j: 403 antes de leer el body, tocar la BD o llamar a Meta", async (role) => {
    state.session = sesion(role);
    const { res, bodyLeido } = await ejecutar(e.file, e.method);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
    expect(state.dbCalls).toBe(0);
    expect(FETCH).not.toHaveBeenCalled();
    expect(bodyLeido).toBe(false);
  });

  it.each(permitidos)("rol %s: pasa la guardia (no es 401 ni 403)", async (role) => {
    state.session = sesion(role);
    const { res } = await ejecutar(e.file, e.method);
    expect([401, 403]).not.toContain(res.status);
  });

  it("sin sesión: 401", async () => {
    const { res } = await ejecutar(e.file, e.method);
    expect(res.status).toBe(401);
    expect(state.dbCalls).toBe(0);
  });
});
