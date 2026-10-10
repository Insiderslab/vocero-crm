import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  initServerForm,
  readSaveResult,
  serverFormReducer,
  type ServerFormState,
} from "@/components/agent/form-sync";

/**
 * Pantalla Agente IA — pérdida de datos reportada en producción ("guardé, la
 * sección 1 no se había guardado y al guardar la 2 se borró todo"):
 * (1) un guardado fallido se daba por bueno; (2) cualquier refetch (p. ej.
 * tras tocar el KB) pisaba el formulario con lo del servidor.
 */

type Form = { name: string; tone: string | null };
const server: Form = { name: "Sofi", tone: "cálido" };

describe("serverFormReducer", () => {
  it("sin cambios del usuario, lo que llega del servidor se muestra", () => {
    const s = serverFormReducer(initServerForm(server), {
      type: "server",
      value: { name: "Sofi 2", tone: null },
    });
    expect(s).toEqual({ form: { name: "Sofi 2", tone: null }, dirty: false });
  });

  it("con cambios sin guardar, un refetch (KB, interruptor) NO los pisa", () => {
    let s: ServerFormState<Form> = initServerForm(server);
    s = serverFormReducer(s, { type: "edit", patch: { tone: "seco y breve" } });
    s = serverFormReducer(s, { type: "server", value: server });
    expect(s).toEqual({ form: { name: "Sofi", tone: "seco y breve" }, dirty: true });
  });

  it("guardado correcto: el formulario queda limpio y vuelve a seguir al servidor", () => {
    let s: ServerFormState<Form> = initServerForm(server);
    s = serverFormReducer(s, { type: "edit", patch: { name: "Martillito" } });
    s = serverFormReducer(s, { type: "saved", value: { name: "Martillito", tone: "cálido" } });
    expect(s.dirty).toBe(false);
    s = serverFormReducer(s, { type: "server", value: { name: "Martillito", tone: "otro" } });
    expect(s.form).toEqual({ name: "Martillito", tone: "otro" });
  });

  it("un guardado fallido no despacha nada: la edición sigue ahí ante el siguiente refetch", () => {
    let s: ServerFormState<Form> = initServerForm(server);
    s = serverFormReducer(s, { type: "edit", patch: { name: "Nuevo nombre" } });
    // (falla el PUT → el componente no despacha "saved") … llega un refetch:
    s = serverFormReducer(s, { type: "server", value: server });
    expect(s.form.name).toBe("Nuevo nombre");
    expect(s.dirty).toBe(true);
  });
});

const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("readSaveResult", () => {
  it("2xx → ok con el JSON", async () => {
    expect(await readSaveResult(res(200, { ok: true, restriction: { a: 1 } }))).toEqual({
      ok: true,
      json: { ok: true, restriction: { a: 1 } },
    });
  });

  it.each([
    [403, { error: { code: "forbidden", message: "Solo owner o admin pueden gestionar esta configuración" } }],
    [422, { error: { code: "invalid_body", message: "name: String must contain at least 1 character(s)" } }],
    [500, { error: { code: "internal", message: "Error interno" } }],
  ])("%i → no ok, con el mensaje del servidor", async (status, body) => {
    expect(await readSaveResult(res(status, body))).toEqual({
      ok: false,
      message: body.error.message,
      invalid: [],
    });
  });

  it("422 con números inválidos → los devuelve", async () => {
    const r = await readSaveResult(
      res(422, { error: { code: "invalid_identities", message: "x", invalid: ["ciao"] } })
    );
    expect(r).toEqual({ ok: false, message: "x", invalid: ["ciao"] });
  });

  it("sin respuesta (red caída) o cuerpo no JSON → no ok, sin mensaje", async () => {
    expect(await readSaveResult(null)).toEqual({ ok: false, message: null, invalid: [] });
    expect(await readSaveResult(new Response("<html>", { status: 502 }))).toEqual({
      ok: false,
      message: null,
      invalid: [],
    });
  });
});

describe("agent-client usa estas reglas (vigilancia)", () => {
  const src = readFileSync(
    path.resolve(import.meta.dirname, "..", "..", "src", "components", "agent", "agent-client.tsx"),
    "utf8"
  );

  it("ningún formulario se resincroniza a ciegas desde props (setForm(profile) y similares)", () => {
    expect(src).not.toMatch(/useEffect\(\s*\(\)\s*=>\s*set[A-Z]\w*\(/);
    expect(src).not.toMatch(/useEffect\(\s*\(\)\s*=>\s*\{\s*set[A-Z]\w*\(\s*restriction/);
  });

  it("todo guardado (PUT/POST/DELETE) pasa por readSaveResult", () => {
    const writes = src.match(/method:\s*"(PUT|POST|DELETE)"/g) ?? [];
    expect(writes.length).toBeGreaterThanOrEqual(4);
    const reads = src.match(/readSaveResult\(/g) ?? [];
    // saveProfile (perfil, interruptor, acceso reservado) + submit del KB
    expect(reads.length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/await fetch\([^)]*\{\s*method:\s*"(PUT|POST|DELETE)"[\s\S]{0,200}?\}\)\.catch\(\(\) => null\);\s*\n\s*(setSaved|onChanged|setQuestion|setBlock)/);
  });

  it("el formulario de comportamiento no reenvía `enabled` (no revierte el interruptor)", () => {
    expect(src).toMatch(/type BehaviorForm = Omit<Profile, "enabled">/);
  });
});
