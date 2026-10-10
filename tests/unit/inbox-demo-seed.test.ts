import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Bandeja vacía: el botón de cargar la demo (POST /api/seed/demo, solo
 * owner/admin) se ofrece solo a quien puede usarlo.
 */

import { ConversationList } from "@/components/inbox/conversation-list";
import { RoleProvider } from "@/components/role-context";

const BOTON = "inbox.empty.seed";

function html(role?: string): string {
  const lista = createElement(ConversationList, {
    conversations: [],
    selectedId: null,
    onSelect: () => undefined,
    onSeeded: () => undefined,
  });
  return renderToStaticMarkup(
    role === undefined ? lista : createElement(RoleProvider, { value: role }, lista)
  );
}

describe("bandeja vacía", () => {
  it.each(["owner", "admin"])("%s puede cargar la demo", (role) => {
    expect(html(role)).toContain(BOTON);
  });

  it.each(["member", "", "Owner", "viewer"])("rol %j no ve el botón de la demo", (role) => {
    const out = html(role);
    expect(out).not.toContain(BOTON);
    expect(out).toContain("inbox.empty.title"); // el estado vacío sigue ahí
  });

  it("sin proveedor de rol no se ofrece", () => {
    expect(html()).not.toContain(BOTON);
  });
});
