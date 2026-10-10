import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Entrada de Configuración (`/settings`): owner/admin aterrizan en la conexión
 * de WhatsApp; un member (o cualquier otro rol, o sin sesión) en el equipo,
 * que sí puede ver. Antes todos iban a /settings/whatsapp y el member caía en
 * el aviso de prohibido.
 */

const state = vi.hoisted(() => ({
  session: null as null | { userId: string; organizationId: string; role: string },
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionOrNull: async () => state.session,
}));

// `redirect` de Next lanza; aquí se lanza el destino para poder leerlo.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import SettingsPage from "@/app/(app)/settings/page";

async function destino(): Promise<string> {
  try {
    await SettingsPage();
  } catch (err) {
    const m = /^REDIRECT:(.*)$/.exec((err as Error).message);
    if (m) return m[1] as string;
    throw err;
  }
  throw new Error("no redirigió");
}

describe("/settings", () => {
  beforeEach(() => {
    state.session = null;
  });

  it.each(["owner", "admin"])("%s va a la conexión de WhatsApp", async (role) => {
    state.session = { userId: "u_1", organizationId: "org_a", role };
    expect(await destino()).toBe("/settings/whatsapp");
  });

  it.each(["member", "", "Owner", "ADMIN", "viewer"])(
    "rol %j va al equipo, no al aviso de prohibido",
    async (role) => {
      state.session = { userId: "u_2", organizationId: "org_a", role };
      expect(await destino()).toBe("/settings/team");
    }
  );

  it("sin sesión va al equipo", async () => {
    expect(await destino()).toBe("/settings/team");
  });
});
