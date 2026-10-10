import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Las dos guardias de rol de las rutas (`withAdminAuth`: owner/admin;
 * `withOwnerAuth`: solo owner) y la regla que las respalda en `roles.ts`.
 * Una sola fuente del 403: las dos responden con la misma forma, antes de
 * ejecutar el handler (que es quien lee el body, la base de datos o Meta).
 */

const state = vi.hoisted(() => ({
  session: null as { userId: string; organizationId: string; role: string } | null,
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

import { withAdminAuth, withOwnerAuth } from "@/lib/api";
import { isOrgAdmin, isOrgOwner } from "@/lib/roles";

const ROLES = ["owner", "admin", "member", "", "Owner", "ADMIN", "viewer", "superadmin"];

function session(role: string) {
  return { userId: "u_1", organizationId: "org_a", role };
}

/** Handler que anota si se ejecutó y si tocó el body. */
function espia() {
  const calls = { handler: 0, body: 0 };
  const handler = async (_s: unknown, req: Request) => {
    calls.handler += 1;
    await req.text();
    return Response.json({ ok: true });
  };
  const req = new Request("http://localhost/x", { method: "POST", body: "{}" });
  const text = req.text.bind(req);
  req.text = async () => {
    calls.body += 1;
    return text();
  };
  return { calls, handler, req };
}

beforeEach(() => {
  state.session = null;
});

describe("reglas de rol (roles.ts)", () => {
  it.each([
    ["owner", true],
    ["admin", true],
    ["member", false],
    ["", false],
    ["Owner", false],
    ["ADMIN", false],
    ["viewer", false],
    ["superadmin", false],
  ])("isOrgAdmin(%j) = %s", (role, esperado) => {
    expect(isOrgAdmin(role)).toBe(esperado);
  });

  it.each([
    ["owner", true],
    ["admin", false],
    ["member", false],
    ["", false],
    ["Owner", false],
    ["OWNER", false],
    ["superadmin", false],
  ])("isOrgOwner(%j) = %s", (role, esperado) => {
    expect(isOrgOwner(role)).toBe(esperado);
  });
});

describe.each([
  ["withAdminAuth", withAdminAuth, (r: string) => r === "owner" || r === "admin"],
  ["withOwnerAuth", withOwnerAuth, (r: string) => r === "owner"],
] as const)("%s", (_nombre, guardia, permitido) => {
  it.each(ROLES)("rol %j: pasa solo si corresponde, y si no 403 sin ejecutar el handler", async (role) => {
    state.session = session(role);
    const { calls, handler, req } = espia();
    const res = await guardia(handler)(req);
    if (permitido(role)) {
      expect(res.status).toBe(200);
      expect(calls.handler).toBe(1);
    } else {
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("forbidden");
      expect(calls.handler).toBe(0);
      expect(calls.body).toBe(0);
    }
  });

  it("sin sesión: 401 y el handler no se ejecuta", async () => {
    const { calls, handler, req } = espia();
    const res = await guardia(handler)(req);
    expect(res.status).toBe(401);
    expect(calls.handler).toBe(0);
  });

  it("un error no controlado del handler sigue siendo 500 sin stack", async () => {
    state.session = session("owner");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await guardia(async () => {
      throw new Error("detalle interno");
    })();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("detalle interno");
  });
});

describe("una sola fuente del 403", () => {
  it("las dos guardias responden con la misma forma de error (código y estructura)", async () => {
    state.session = session("member");
    const handler = async () => Response.json({});
    const a = await withAdminAuth(handler)();
    const b = await withOwnerAuth(handler)();
    const ja = await a.json();
    const jb = await b.json();
    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
    expect(Object.keys(ja.error).sort()).toEqual(["code", "message"]);
    expect(Object.keys(jb.error).sort()).toEqual(["code", "message"]);
    expect(ja.error.code).toBe(jb.error.code);
  });

  it('el código "forbidden" del 403 por rol solo se escribe en src/lib/api.ts', async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { default: path } = await import("node:path");
    const raiz = path.resolve(import.meta.dirname, "..", "..", "src");
    const archivos = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? archivos(path.join(dir, e.name))
          : /\.tsx?$/.test(e.name)
            ? [path.join(dir, e.name)]
            : []
      );
    const conCodigo = archivos(raiz)
      .filter((f) => readFileSync(f, "utf8").includes('"forbidden"'))
      .map((f) => path.relative(raiz, f).split(path.sep).join("/"));
    expect(conCodigo).toEqual(["lib/api.ts"]);
  });
});
