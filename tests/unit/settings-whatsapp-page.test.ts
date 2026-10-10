import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { canManageApiKeys, canManageWhatsapp, isOrgAdmin } from "@/lib/roles";

/**
 * Página /settings/whatsapp: el asistente de conexión solo se pinta para
 * owner/admin; un member, o sin sesión, ve solo el aviso. La API ya lo exige
 * por su cuenta (settings-whatsapp-routes.test.ts).
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

// El asistente real es un componente cliente con fetch; aquí basta saber si se pinta.
vi.mock("@/components/settings/whatsapp-wizard", () => ({
  WhatsappWizard: () => "WIZARD-DE-CONEXION",
}));

import WhatsappSettingsPage from "@/app/(app)/settings/whatsapp/page";

async function html(): Promise<string> {
  return renderToStaticMarkup(await WhatsappSettingsPage());
}

describe("reglas de rol: una sola fuente", () => {
  const roles = ["owner", "admin", "member", "", "Owner", "ADMIN", "viewer"];
  it.each(roles)("rol %j: claves de API y WhatsApp coinciden con isOrgAdmin", (role) => {
    expect(canManageWhatsapp(role)).toBe(isOrgAdmin(role));
    expect(canManageApiKeys(role)).toBe(isOrgAdmin(role));
  });

  it("solo owner y admin", () => {
    expect(canManageWhatsapp("owner")).toBe(true);
    expect(canManageWhatsapp("admin")).toBe(true);
    expect(canManageWhatsapp("member")).toBe(false);
  });
});

describe("/settings/whatsapp", () => {
  beforeEach(() => {
    state.session = null;
  });

  it("member: solo el aviso, sin asistente", async () => {
    state.session = { userId: "u_m", organizationId: "org_a", role: "member" };
    const out = await html();
    expect(out).toContain("settings.whatsapp.forbidden");
    expect(out).not.toContain("WIZARD-DE-CONEXION");
  });

  it("sin sesión: solo el aviso", async () => {
    const out = await html();
    expect(out).toContain("settings.whatsapp.forbidden");
    expect(out).not.toContain("WIZARD-DE-CONEXION");
  });

  it.each(["owner", "admin"])("%s ve el asistente", async (role) => {
    state.session = { userId: "u_1", organizationId: "org_a", role };
    const out = await html();
    expect(out).toContain("WIZARD-DE-CONEXION");
    expect(out).not.toContain("settings.whatsapp.forbidden");
  });
});
