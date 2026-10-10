import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyList, loadKeyList, type KeyListState } from "@/components/settings/api-keys-client";

/**
 * Listado de /settings/api-keys: si el GET falla (red, 403, 500, cuerpo
 * inesperado) se muestra un error explícito, nunca "aún no hay claves", que
 * haría creer que no hay claves activas que revocar.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const KEY = {
  id: "k_1",
  label: "bot de producción",
  keyPrefix: "vbk_AbCdEfGh",
  createdAt: "2026-10-01T10:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};

describe("loadKeyList", () => {
  it("red caída → error", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await loadKeyList("/api/settings/bot-keys", fetcher)).toEqual({ status: "error" });
  });

  it.each([403, 500])("HTTP %i → error, no lista vacía", async (status) => {
    const fetcher = vi.fn(async () =>
      json(status, { error: { code: "x", message: "y" }, keys: [] })
    );
    expect(await loadKeyList("/api/settings/bot-keys", fetcher)).toEqual({ status: "error" });
  });

  it("200 con un cuerpo que no es JSON o sin `keys` → error", async () => {
    const notJson = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await loadKeyList("/x", notJson)).toEqual({ status: "error" });
    const noKeys = vi.fn(async () => json(200, { ok: true }));
    expect(await loadKeyList("/x", noKeys)).toEqual({ status: "error" });
  });

  it("200 con claves → ready; 200 con [] → ready vacío", async () => {
    const withKeys = vi.fn(async () => json(200, { keys: [KEY] }));
    expect(await loadKeyList("/api/settings/bot-keys", withKeys)).toEqual({
      status: "ready",
      keys: [KEY],
    });
    expect(withKeys).toHaveBeenCalledWith("/api/settings/bot-keys", { cache: "no-store" });
    const empty = vi.fn(async () => json(200, { keys: [] }));
    expect(await loadKeyList("/x", empty)).toEqual({ status: "ready", keys: [] });
  });
});

describe("KeyList", () => {
  const html = (list: KeyListState) =>
    renderToStaticMarkup(createElement(KeyList, { list, onRevoke: () => {} }));

  it("error: aviso explícito, sin el texto de 'sin claves'", () => {
    const out = html({ status: "error" });
    expect(out).toContain("settings.apiKeys.listError");
    expect(out).toContain('role="alert"');
    expect(out).not.toContain("settings.apiKeys.empty");
  });

  it("cargando: no dice 'sin claves'", () => {
    const out = html({ status: "loading" });
    expect(out).toContain("common.loading");
    expect(out).not.toContain("settings.apiKeys.empty");
  });

  it("lista vacía de verdad: 'sin claves'", () => {
    const out = html({ status: "ready", keys: [] });
    expect(out).toContain("settings.apiKeys.empty");
    expect(out).not.toContain("settings.apiKeys.listError");
  });

  it("con claves: nombre y prefijo, sin avisos", () => {
    const out = html({ status: "ready", keys: [KEY] });
    expect(out).toContain("bot de producción");
    expect(out).toContain("vbk_AbCdEfGh");
    expect(out).not.toContain("settings.apiKeys.empty");
    expect(out).not.toContain("settings.apiKeys.listError");
  });
});
