import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConversationDto } from "@/lib/types";
import { ConversationList } from "@/components/inbox/conversation-list";
import { ContactPanel } from "@/components/inbox/contact-panel";
import {
  handoffLabel,
  matchesInboxFilter,
  sortHandoffFirst,
} from "@/components/inbox/helpers";
import { pushAlert } from "@/components/handoff-alerts";
import { subscribeToEvents } from "@/components/use-events";

/**
 * 009 (E1c/E1d) — Visibilidad del handoff en la bandeja y avisos en la app.
 * Sin proveedor de i18n `t()` devuelve la llave: las aserciones miran llaves.
 */

function conv(id: string, patch: Partial<ConversationDto> = {}): ConversationDto {
  return {
    id,
    contact: { id: `ct_${id}`, name: `Nombre ${id}`, phone: null },
    stageName: null,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: null,
    lastMessageAt: null,
    unreadCount: 0,
    windowOpen: false,
    windowRemainingMs: 0,
    preview: null,
    ...patch,
  };
}

const t = (key: string) => key;

describe("helpers de la bandeja", () => {
  const lista = [
    conv("a"),
    conv("b", { handoffAt: "2030-01-01T10:00:00Z", handoffReason: "error" }),
    conv("c", { unreadCount: 2 }),
    conv("d", { handoffAt: "2030-01-01T09:00:00Z", handoffReason: "cliente" }),
  ];

  it("el handoff va arriba y el orden dentro de cada grupo se conserva (estable)", () => {
    expect(sortHandoffFirst(lista).map((c) => c.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("filtro «Asistencia humana» = handoff activo", () => {
    expect(lista.filter((c) => matchesInboxFilter(c, "handoff")).map((c) => c.id)).toEqual(["b", "d"]);
    expect(lista.filter((c) => matchesInboxFilter(c, "unread")).map((c) => c.id)).toEqual(["c"]);
    expect(lista.filter((c) => matchesInboxFilter(c, "all"))).toHaveLength(4);
  });

  it("un handoff con segundo intento pendiente NO cuenta como «asistencia humana»", () => {
    const pendiente = conv("p", {
      handoffAt: "2030-01-01T10:00:00Z",
      handoffReason: "error",
      agentRetryAt: "2030-01-01T10:01:00Z",
    });
    expect(matchesInboxFilter(pendiente, "handoff")).toBe(false);
    expect(sortHandoffFirst([conv("a"), pendiente, lista[1]!]).map((c) => c.id)).toEqual(["b", "a", "p"]);
  });

  it("etiqueta del motivo; `error` → «Errore del provider IA»", () => {
    expect(handoffLabel("error", t)).toBe("inbox.handoffReasons.error");
    expect(handoffLabel("hostilidad", t)).toBe("inbox.handoffReasons.hostilidad");
    expect(handoffLabel("desconocido", t)).toBe("inbox.handoff");
    expect(handoffLabel(null, t)).toBe("inbox.handoff");
  });
});

describe("lista de conversaciones", () => {
  const html = renderToStaticMarkup(
    createElement(ConversationList, {
      conversations: [
        conv("a"),
        conv("b", { handoffAt: "2030-01-01T10:00:00Z", handoffReason: "error" }),
      ],
      selectedId: null,
      onSelect: () => undefined,
      onSeeded: () => undefined,
    })
  );

  it("ofrece el filtro de asistencia humana con su conteo", () => {
    expect(html).toContain("inbox.filters.handoff");
  });

  it("una conversación con segundo intento pendiente lleva la etiqueta «IA: nuovo tentativo in corso»", () => {
    const out = renderToStaticMarkup(
      createElement(ConversationList, {
        conversations: [
          conv("p", { handoffAt: "2030-01-01T10:00:00Z", handoffReason: "error", agentRetryAt: "2030-01-01T10:01:00Z" }),
        ],
        selectedId: null,
        onSelect: () => undefined,
        onSeeded: () => undefined,
      })
    );
    expect(out).toContain("inbox.retryPending");
    expect(out).not.toContain("inbox.handoffReasons.error");
  });

  it("muestra el motivo del handoff y lo pone primero", () => {
    expect(html).toContain("inbox.handoffReasons.error");
    expect(html.indexOf("Nombre b")).toBeLessThan(html.indexOf("Nombre a"));
  });
});

describe("panel del contacto", () => {
  const render = (patch: Partial<ConversationDto>, withRetry = true) =>
    renderToStaticMarkup(
      createElement(ContactPanel, {
        conversation: conv("x", patch),
        onPatchConversation: async () => undefined,
        onRetryAi: withRetry ? async () => null : undefined,
        onClose: () => undefined,
      })
    );

  it("con handoff: «Riprova risposta IA» y el motivo", () => {
    const out = render({ handoffAt: "2030-01-01T10:00:00Z", handoffReason: "error" });
    expect(out).toContain("inbox.panel.retryAi");
    expect(out).toContain("inbox.handoffReasons.error");
    expect(out).toContain("inbox.panel.reactivate");
  });

  it("segundo intento pendiente: aviso propio, no el de asistencia humana", () => {
    const out = render({
      handoffAt: "2030-01-01T10:00:00Z",
      handoffReason: "error",
      agentRetryAt: "2030-01-01T10:01:00Z",
    });
    expect(out).toContain("inbox.retryPending");
    expect(out).toContain("data-retry-pending");
  });

  it("sin handoff no hay nada que reintentar", () => {
    expect(render({})).not.toContain("inbox.panel.retryAi");
  });
});

describe("avisos de handoff", () => {
  const a = (id: string, reason = "error") => ({ conversationId: id, reason, contactName: id });

  it("uno por conversación; el más nuevo arriba; como mucho tres", () => {
    let list = pushAlert([], a("1"));
    list = pushAlert(list, a("2"));
    list = pushAlert(list, a("1", "cliente"));
    expect(list.map((x) => `${x.conversationId}:${x.reason}`)).toEqual(["1:cliente", "2:error"]);
    list = pushAlert(pushAlert(list, a("3")), a("4"));
    expect(list.map((x) => x.conversationId)).toEqual(["4", "3", "1"]);
  });
});

describe("una sola conexión SSE compartida", () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    listeners = new Map<string, ((ev: { data: string }) => void)[]>();
    closed = false;
    onerror: (() => void) | null = null;
    onopen: (() => void) | null = null;
    constructor(public url: string) {
      FakeEventSource.instances.push(this);
    }
    addEventListener(type: string, fn: (ev: { data: string }) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    emit(type: string, data: unknown) {
      for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
    }
    close() {
      this.closed = true;
    }
  }
  const g = globalThis as unknown as { EventSource?: unknown };
  const original = g.EventSource;
  afterEach(() => {
    g.EventSource = original;
    FakeEventSource.instances = [];
  });

  it("dos suscriptores, un EventSource; el aviso llega a quien lo escucha; se cierra con el último", () => {
    g.EventSource = FakeEventSource;
    const received: unknown[] = [];
    const nav = { current: { onConversationUpdated: () => undefined } };
    const alerts = { current: { onHandoff: (d: unknown) => received.push(d) } };
    const offNav = subscribeToEvents(nav);
    const offAlerts = subscribeToEvents(alerts);
    expect(FakeEventSource.instances).toHaveLength(1);

    const es = FakeEventSource.instances[0]!;
    es.emit("conversation.handoff", { conversationId: "cv_1", reason: "error", contactName: "Ana" });
    expect(received).toEqual([{ conversationId: "cv_1", reason: "error", contactName: "Ana" }]);

    offNav();
    expect(es.closed).toBe(false);
    offAlerts();
    expect(es.closed).toBe(true);
  });
});
