import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * /settings/whatsapp: la tarjeta de la clave Wapi solo se pinta para
 * owner/admin (la API ya lo exige por su cuenta; ver wapi-key-routes.test.ts).
 */

const state = vi.hoisted(() => ({
  session: null as null | { userId: string; organizationId: string; role: string },
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionOrNull: async () => state.session,
}));

import WhatsappSettingsPage from "@/app/(app)/settings/whatsapp/page";

async function html(): Promise<string> {
  return renderToStaticMarkup(await WhatsappSettingsPage());
}

// En SSR los componentes cliente pintan su estado "cargando"; para distinguir
// la tarjeta Wapi se mira el mismo texto de carga duplicado: dos bloques
// (asistente + tarjeta) para owner/admin, uno solo para el resto.
const loadingBlocks = (out: string) => out.split("common.loading").length - 1;

describe("/settings/whatsapp (tarjeta de la clave Wapi)", () => {
  beforeEach(() => {
    state.session = null;
  });

  it.each(["owner", "admin"])("%s: asistente de WhatsApp + tarjeta Wapi", async (role) => {
    state.session = { userId: "u_1", organizationId: "org_a", role };
    expect(loadingBlocks(await html())).toBe(2);
  });

  it.each(["member", "otro"])("%s: solo el asistente, sin tarjeta Wapi", async (role) => {
    state.session = { userId: "u_1", organizationId: "org_a", role };
    expect(loadingBlocks(await html())).toBe(1);
  });

  it("sin sesión: sin tarjeta Wapi", async () => {
    expect(loadingBlocks(await html())).toBe(1);
  });
});
