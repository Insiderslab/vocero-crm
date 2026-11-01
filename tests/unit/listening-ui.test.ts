import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 016 — Interfaccia: voce nel menu (solo owner/admin) e striscia nella Posta. */

const st = vi.hoisted(() => ({
  session: null as { organizationId: string; role: string } | null,
  on: new Set<string>(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/team" }));
vi.mock("@/lib/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/session")>()),
  getSessionOrNull: async () => st.session,
}));
vi.mock("@/server/listening/mode", async (orig) => ({
  ...(await orig<typeof import("@/server/listening/mode")>()),
  isListeningMode: async (org: string) => st.on.has(org),
}));
vi.mock("@/components/inbox/inbox-client", () => ({ InboxClient: () => createElement("div", null, "INBOX") }));
vi.mock("@/lib/i18n/server", async () => {
  const { messagesFor } = await import("@/lib/i18n/messages");
  const { translate } = await import("@/lib/i18n/t");
  return { getT: async () => ({ t: (k: string) => translate(messagesFor("it"), k) }) };
});

import InboxPage from "@/app/(app)/inbox/page";
import { SettingsNav } from "@/components/settings/settings-nav";
import { RoleProvider } from "@/components/role-context";

const html = async () => renderToStaticMarkup(await InboxPage());
const TAB = 'href="/settings/listening"';

beforeEach(() => {
  st.session = { organizationId: "org_a", role: "member" };
  st.on = new Set(["org_a"]);
});

describe("striscia nella Posta", () => {
  it("accesa: la striscia c'è, in italiano, e la Posta resta", async () => {
    const out = await html();
    expect(out).toContain("Modalità ascolto attiva: l&#x27;agente AI e le automazioni non inviano messaggi");
    expect(out).toContain("INBOX");
  });

  it("negativo con due organizzazioni: sessione di B → nessuna striscia", async () => {
    st.session = { organizationId: "org_b", role: "member" };
    const out = await html();
    expect(out).not.toContain("Modalità ascolto");
    expect(out).toContain("INBOX");
  });

  it("senza sessione: nessuna striscia", async () => {
    st.session = null;
    expect(await html()).not.toContain("Modalità ascolto");
  });
});

describe("voce Modalità ascolto nel menu delle impostazioni", () => {
  const nav = (role: string) => renderToStaticMarkup(createElement(RoleProvider, { value: role }, createElement(SettingsNav)));
  it.each(["owner", "admin"])("%s la vede", (role) => expect(nav(role)).toContain(TAB));
  it.each(["member", "", "Owner", "viewer"])("rol %j non la vede", (role) => expect(nav(role)).not.toContain(TAB));
});
