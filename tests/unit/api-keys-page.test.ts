import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Página /settings/api-keys: la gestión de claves (bot y export) solo se pinta
 * para owner/admin. Un member, o sin sesión, ve solo el aviso. La API ya lo
 * exige por su cuenta (tests de rutas); aquí se prueba la página.
 */

const state = vi.hoisted(() => ({
  session: null as null | { userId: string; organizationId: string; role: string },
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionOrNull: async () => state.session,
}));

vi.mock("@/lib/i18n/server", () => ({
  getT: async () => ({ locale: "es", t: (key: string) => key }),
}));

import ApiKeysSettingsPage from "@/app/(app)/settings/api-keys/page";
import { canManageApiKeys } from "@/server/api-keys-admin";

async function html(): Promise<string> {
  return renderToStaticMarkup(await ApiKeysSettingsPage());
}

describe("canManageApiKeys", () => {
  it("solo owner y admin", () => {
    expect(canManageApiKeys("owner")).toBe(true);
    expect(canManageApiKeys("admin")).toBe(true);
    expect(canManageApiKeys("member")).toBe(false);
    expect(canManageApiKeys("")).toBe(false);
    expect(canManageApiKeys("Owner")).toBe(false);
  });
});

describe("/settings/api-keys", () => {
  beforeEach(() => {
    state.session = null;
  });

  it("member: solo el aviso, sin formulario ni listas de claves", async () => {
    state.session = { userId: "u_m", organizationId: "org_a", role: "member" };
    const out = await html();
    expect(out).toContain("settings.apiKeys.forbidden");
    expect(out).not.toContain("settings.apiKeys.bot.title");
    expect(out).not.toContain("settings.apiKeys.export.title");
    expect(out).not.toContain("<input");
  });

  it("sin sesión: solo el aviso", async () => {
    const out = await html();
    expect(out).toContain("settings.apiKeys.forbidden");
    expect(out).not.toContain("<input");
  });

  it.each(["owner", "admin"])("%s: gestiona claves de bot y de export", async (role) => {
    state.session = { userId: "u_1", organizationId: "org_a", role };
    const out = await html();
    expect(out).not.toContain("settings.apiKeys.forbidden");
    expect(out).toContain("settings.apiKeys.bot.title");
    expect(out).toContain("settings.apiKeys.export.title");
    expect(out).toContain('id="bot-key-label"');
    expect(out).toContain('id="export-key-label"');
  });
});
