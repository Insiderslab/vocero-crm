import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * 010 — la PÁGINA decide quién ve «Primi passi»: en Sintesi (que ve cualquier
 * miembro) la tarjeta es solo de owner/admin, también con la reapertura
 * `?primi-passi=1`; un member ni siquiera dispara la consulta. Vigila el
 * cableado de la página, no solo `showOnboardingChecklist`.
 */

const state = vi.hoisted(() => ({
  session: null as null | { userId: string; organizationId: string; role: string },
  allDone: false,
  calls: [] as string[],
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionOrNull: async () => state.session,
}));

vi.mock("@/lib/i18n/server", () => ({
  getT: async () => ({ locale: "es", t: (key: string) => key }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

vi.mock("@/components/dashboard/dashboard-client", () => ({
  DashboardClient: () => "CLIENTE-SINTESI",
}));

vi.mock("@/server/onboarding/checklist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/onboarding/checklist")>();
  return {
    ...actual,
    getOnboardingChecklist: async (organizationId: string) => {
      state.calls.push(organizationId);
      return {
        whatsappConnected: true,
        templateApproved: state.allDone,
        agentConfigured: state.allDone,
        labRunDone: state.allDone,
        agentEnabled: state.allDone,
        allDone: state.allDone,
      };
    },
  };
});

import DashboardPage from "@/app/(app)/dashboard/page";

const TARJETA = "onboarding.title";

async function render(params: Record<string, string> = {}) {
  return renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve(params) }));
}

describe("010 Sintesi — «Primi passi» por rol", () => {
  beforeEach(() => {
    state.session = null;
    state.allDone = false;
    state.calls = [];
  });

  it.each(["member", "", "Owner", "viewer"])(
    "rol %j: ve la Sintesi pero no la tarjeta, ni reabierta, y no consulta la checklist",
    async (role) => {
      state.session = { userId: "u_m", organizationId: "org_a", role };
      for (const params of [{}, { "primi-passi": "1" }] as Record<string, string>[]) {
        const out = await render(params);
        expect(out).toContain("CLIENTE-SINTESI");
        expect(out).not.toContain(TARJETA);
      }
      expect(state.calls).toEqual([]);
    }
  );

  it.each(["owner", "admin"])("%s ve la tarjeta mientras falte algún paso", async (role) => {
    state.session = { userId: "u_1", organizationId: "org_a", role };
    const out = await render();
    expect(out).toContain(TARJETA);
    expect(out).toContain("CLIENTE-SINTESI");
    expect(state.calls).toEqual(["org_a"]);
  });

  it("completa: oculta, salvo con la reapertura de Impostazioni", async () => {
    state.session = { userId: "u_1", organizationId: "org_a", role: "owner" };
    state.allDone = true;
    expect(await render()).not.toContain(TARJETA);
    expect(await render({ "primi-passi": "1" })).toContain(TARJETA);
  });
});
