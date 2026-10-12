import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactsClient } from "@/components/contacts/contacts-client";
import { PipelineClient } from "@/components/pipeline/pipeline-client";
import { LabClient } from "@/components/lab/lab-client";
import { AutomationsClient } from "@/components/automations/automations-client";
import { AgentClient } from "@/components/agent/agent-client";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import AppLoading from "@/app/(app)/loading";

/**
 * 009 (E3) — Antes de la primera respuesta cada pantalla enseña un esqueleto
 * (`role="status"`, `data-loading`), NUNCA su estado vacío: "/contacts" decía
 * «Nessun contatto» mientras cargaba. El primer render es justo eso: el HTML
 * del servidor, antes de que corra ningún efecto ni llegue ningún fetch.
 * Sin proveedor de i18n `t()` devuelve la llave.
 */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const LOADING = 'data-loading=""';

describe("primer render = esqueleto, no estado vacío", () => {
  it("contactos", () => {
    const out = html(createElement(ContactsClient));
    expect(out).toContain(LOADING);
    expect(out).not.toContain("contacts.empty.title");
  });

  it("pipeline", () => {
    const out = html(createElement(PipelineClient));
    expect(out).toContain(LOADING);
  });

  it("laboratorio", () => {
    const out = html(createElement(LabClient));
    expect(out).toContain(LOADING);
    expect(out).not.toContain("lab.emptyFirst");
    expect(out).not.toContain("lab.historyEmpty");
  });

  it("automatizaciones", () => {
    const out = html(createElement(AutomationsClient));
    expect(out).toContain(LOADING);
    expect(out).not.toContain("admin.automations.emptyPre");
  });

  it("agente", () => {
    const out = html(createElement(AgentClient));
    expect(out).toContain(LOADING);
  });

  it("bandeja: lista sin datos todavía", () => {
    const out = html(
      createElement(ConversationList, {
        conversations: null,
        selectedId: null,
        onSelect: () => undefined,
        onSeeded: () => undefined,
      })
    );
    expect(out).toContain(LOADING);
    expect(out).not.toContain("inbox.empty.title");
  });

  it("bandeja: si la primera carga falla se dice, con reintento", () => {
    const out = html(
      createElement(ConversationList, {
        conversations: null,
        selectedId: null,
        onSelect: () => undefined,
        onSeeded: () => undefined,
        loadFailed: true,
      })
    );
    expect(out).toContain("common.loadError");
    expect(out).toContain("common.retry");
  });

  it("hilo recién elegido: esqueleto, no un hilo vacío", () => {
    expect(html(createElement(MessageThread, { messages: [], loading: true }))).toContain(LOADING);
    expect(html(createElement(MessageThread, { messages: [] }))).not.toContain(LOADING);
  });

  it("navegación: la sección enseña su esqueleto (loading.tsx)", () => {
    expect(html(createElement(AppLoading))).toContain(LOADING);
  });
});
