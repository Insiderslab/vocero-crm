import { describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Navegación de Configuración: la pestaña de claves API solo para owner/admin,
 * con el rol que ya resuelve el layout de (app) (contexto, sin consultas nuevas).
 * Sin proveedor no se pinta (fail-closed). La página y la API lo exigen igual.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/team" }));
// El lateral (cliente de auth, SSE) no hace falta para probar el contexto del rol.
vi.mock("@/components/app-nav", () => ({ AppNav: () => null }));

import { SettingsNav } from "@/components/settings/settings-nav";
import { RoleProvider } from "@/components/role-context";
import { AppShell } from "@/components/app-shell";
import { DEFAULT_BRANDING } from "@/lib/branding";

const API_KEYS = 'href="/settings/api-keys"';

function html(role?: string): string {
  const nav = createElement(SettingsNav);
  return renderToStaticMarkup(
    role === undefined ? nav : createElement(RoleProvider, { value: role }, nav)
  );
}

describe("SettingsNav: pestaña de claves API", () => {
  it.each(["owner", "admin"])("%s la ve", (role) => {
    expect(html(role)).toContain(API_KEYS);
  });

  it.each(["member", "", "Owner"])("rol %j: no la ve, pero sí el resto", (role) => {
    const out = html(role);
    expect(out).not.toContain(API_KEYS);
    expect(out).toContain('href="/settings/team"');
    expect(out).toContain('href="/settings/whatsapp"');
  });

  it("sin proveedor de rol: no la ve", () => {
    expect(html()).not.toContain(API_KEYS);
  });

  it.each([
    ["owner", true],
    ["admin", true],
    ["member", false],
  ] as const)("AppShell pasa el rol de la sesión a la navegación: %s", (role, visible) => {
    // Los hijos van como tercer argumento de createElement (react/no-children-prop).
    const props = {
      branding: DEFAULT_BRANDING,
      userName: "U",
      role,
      theme: "light",
      locale: "es",
    } as ComponentProps<typeof AppShell>;
    const out = renderToStaticMarkup(createElement(AppShell, props, createElement(SettingsNav)));
    expect(out.includes(API_KEYS)).toBe(visible);
  });
});
