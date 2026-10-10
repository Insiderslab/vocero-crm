import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

/**
 * Pantallas de configuración de la organización (agente, Laboratorio,
 * automatizaciones, plantillas): solo owner/admin las ven; un member, o sin
 * sesión, ve el aviso. La API ya lo exige por su cuenta
 * (route-roles-behavior.test.ts): esto evita pintar pantallas cuyas acciones
 * fallarían.
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

// Los clientes reales hacen fetch y pintan mucho; aquí basta saber si se pintan.
vi.mock("@/components/agent/agent-client", () => ({ AgentClient: () => "CLIENTE-AGENTE" }));
vi.mock("@/components/lab/lab-client", () => ({ LabClient: () => "CLIENTE-LAB" }));
vi.mock("@/components/automations/automations-client", () => ({
  AutomationsClient: () => "CLIENTE-AUTOMATIZACIONES",
}));
vi.mock("@/components/settings/templates-client", () => ({
  TemplatesClient: () => "CLIENTE-PLANTILLAS",
}));

import AgentPage from "@/app/(app)/agent/page";
import AutomationsPage from "@/app/(app)/automations/page";
import LabPage from "@/app/(app)/lab/page";
import TemplatesSettingsPage from "@/app/(app)/settings/templates/page";

const PAGINAS: [string, () => Promise<ReactNode>, string][] = [
  ["/agent", AgentPage, "CLIENTE-AGENTE"],
  ["/lab", LabPage, "CLIENTE-LAB"],
  ["/automations", AutomationsPage, "CLIENTE-AUTOMATIZACIONES"],
  ["/settings/templates", TemplatesSettingsPage, "CLIENTE-PLANTILLAS"],
];

const AVISO = "common.adminOnly";

describe.each(PAGINAS)("%s", (_ruta, Pagina, cliente) => {
  beforeEach(() => {
    state.session = null;
  });

  const html = async () => renderToStaticMarkup(await Pagina());

  it.each(["member", "", "Owner", "ADMIN", "viewer"])(
    "rol %j: solo el aviso, sin la pantalla",
    async (role) => {
      state.session = { userId: "u_m", organizationId: "org_a", role };
      const out = await html();
      expect(out).toContain(AVISO);
      expect(out).not.toContain(cliente);
    }
  );

  it("sin sesión: solo el aviso", async () => {
    const out = await html();
    expect(out).toContain(AVISO);
    expect(out).not.toContain(cliente);
  });

  it.each(["owner", "admin"])("%s ve la pantalla", async (role) => {
    state.session = { userId: "u_1", organizationId: "org_a", role };
    const out = await html();
    expect(out).toContain(cliente);
    expect(out).not.toContain(AVISO);
  });
});
