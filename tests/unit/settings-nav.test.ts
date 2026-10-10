import { describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Navegación de Configuración: las pestañas de conexión de WhatsApp, plantillas
 * y claves API solo para owner/admin, con el rol que ya resuelve el layout de
 * (app) (contexto, sin consultas nuevas). Un member ve marca y equipo. Sin
 * proveedor no se pinta ninguna reservada (fail-closed). Las páginas y la API
 * lo exigen igual.
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

const WHATSAPP = 'href="/settings/whatsapp"';
const TEMPLATES = 'href="/settings/templates"';
const RESERVADAS = [WHATSAPP, TEMPLATES, API_KEYS];
const ABIERTAS = ['href="/settings/branding"', 'href="/settings/team"'];

describe("SettingsNav: pestañas reservadas a owner/admin", () => {
  it.each(["owner", "admin"])("%s ve todas", (role) => {
    const out = html(role);
    for (const href of [...RESERVADAS, ...ABIERTAS]) expect(out).toContain(href);
  });

  it.each(["member", "", "Owner", "ADMIN", "viewer"])(
    "rol %j: no ve WhatsApp, plantillas ni claves API, pero sí marca y equipo",
    (role) => {
      const out = html(role);
      for (const href of RESERVADAS) expect(out).not.toContain(href);
      for (const href of ABIERTAS) expect(out).toContain(href);
    }
  );

  it("sin proveedor de rol: ninguna reservada, solo las abiertas", () => {
    const out = html();
    for (const href of RESERVADAS) expect(out).not.toContain(href);
    for (const href of ABIERTAS) expect(out).toContain(href);
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
