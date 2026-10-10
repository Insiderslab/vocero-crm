import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Lateral de la app: las entradas de configuración (automatizaciones, agente,
 * Laboratorio) solo para owner/admin; el miembro ve bandeja, pipeline y
 * contactos. Es solo navegación: las páginas y la API exigen el mismo rol.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/components/use-events", () => ({ useEvents: () => undefined }));
vi.mock("@/lib/auth/client", () => ({
  authClient: { organization: { setActive: async () => undefined } },
  signOut: async () => undefined,
}));

import { AppNav } from "@/components/app-nav";
import { DEFAULT_BRANDING } from "@/lib/branding";

const html = (role: string) =>
  renderToStaticMarkup(
    createElement(AppNav, { branding: DEFAULT_BRANDING, userName: "U", role, theme: "light", locale: "es" })
  );

const ADMIN = ['href="/automations"', 'href="/agent"', 'href="/lab"'];
const DIARIO = ['href="/inbox"', 'href="/pipeline"', 'href="/contacts"'];

describe("AppNav", () => {
  it.each(["owner", "admin"])("%s ve todo", (role) => {
    const out = html(role);
    for (const href of [...ADMIN, ...DIARIO]) expect(out).toContain(href);
  });

  it.each(["member", "", "Owner", "viewer"])(
    "rol %j: solo bandeja, pipeline y contactos",
    (role) => {
      const out = html(role);
      for (const href of ADMIN) expect(out).not.toContain(href);
      for (const href of DIARIO) expect(out).toContain(href);
    }
  );
});
