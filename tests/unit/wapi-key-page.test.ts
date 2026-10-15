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

// Fuera de una petición no hay cookies: el aviso se traduce con la clave tal cual.
vi.mock("@/lib/i18n/server", () => ({
  getT: async () => ({ t: (key: string) => key }),
}));

import WhatsappSettingsPage from "@/app/(app)/settings/whatsapp/page";

async function html(): Promise<string> {
  return renderToStaticMarkup(await WhatsappSettingsPage());
}

// En SSR los componentes cliente pintan su estado "cargando"; para distinguir
// la tarjeta Wapi se mira el mismo texto de carga repetido: 013 — tres
// bloques para owner/admin (guía, «Avanzate» con el modo manual y la tarjeta
// Wapi, también dentro de «Avanzate»), ninguno para el resto.
const loadingBlocks = (out: string) => out.split("common.loading").length - 1;
/** Lo que queda dentro de <details id="avanzate">…</details>. */
const advanced = (out: string) => /<details id="avanzate"[\s\S]*?<\/details>/.exec(out)?.[0] ?? "";

describe("/settings/whatsapp (tarjeta de la clave Wapi)", () => {
  beforeEach(() => {
    state.session = null;
  });

  it.each(["owner", "admin"])("%s: asistente de WhatsApp + tarjeta Wapi", async (role) => {
    state.session = { userId: "u_1", organizationId: "org_a", role };
    const out = await html();
    expect(loadingBlocks(out)).toBe(3);
    // 013: el modo manual y la tarjeta Wapi viven en «Avanzate», cerrada.
    expect(loadingBlocks(advanced(out))).toBe(2);
    expect(advanced(out)).not.toMatch(/<details[^>]*\bopen\b/);
  });

  // Desde el control de rol de la página (ruoli-whatsapp), quien no es
  // owner/admin no ve ni el asistente ni la tarjeta: solo el aviso.
  it.each(["member", "otro"])("%s: ni asistente ni tarjeta Wapi, solo el aviso", async (role) => {
    state.session = { userId: "u_1", organizationId: "org_a", role };
    const out = await html();
    expect(loadingBlocks(out)).toBe(0);
    expect(out).toContain("forbidden");
  });

  it("sin sesión: ni asistente ni tarjeta Wapi", async () => {
    const out = await html();
    expect(loadingBlocks(out)).toBe(0);
    expect(out).toContain("forbidden");
  });
});
