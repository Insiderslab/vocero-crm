import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LOCALES, type Locale } from "@/lib/i18n";
import { messagesFor } from "@/lib/i18n/messages";
import { translate } from "@/lib/i18n/t";
import {
  canConnectAnotherNumber,
  connectionMode,
  guideState,
  guideSteps,
  reconnectVia,
  signatureState,
  type GuideConnection,
  type GuideState,
  type SignatureInfo,
} from "@/lib/whatsapp-guide";
import type { WhatsappGuideStatus } from "@/server/whatsapp/guide-status";

// La vista no abre el SSE ni llama a la API; los hijos cliente no se ejecutan en SSR.
vi.mock("@/components/use-events", () => ({ useEvents: () => undefined }));

import { AnotherNumberWithMeta, WhatsappGuideView } from "@/components/settings/whatsapp-guide";

/**
 * 013 — Pagina guidata di Configurazione → WhatsApp: la macchina a stati pura
 * e la vista in ogni stato e in ogni lingua (senza chiavi crude).
 */

const NOW = Date.parse("2026-10-15T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const conn = (over: Partial<GuideConnection> = {}): GuideConnection => ({
  status: "connected",
  appDisconnectedAt: null,
  onboardingMode: "coexistence",
  ...over,
});

describe("guideState", () => {
  it.each<[string, { platformReady: boolean; connection: GuideConnection | null }, GuideState]>([
    ["piattaforma non configurata, nessun numero", { platformReady: false, connection: null }, "not_configured"],
    ["piattaforma pronta, nessun numero", { platformReady: true, connection: null }, "ready"],
    ["numero collegato", { platformReady: true, connection: conn() }, "connected"],
    ["numero collegato anche se la piattaforma perde la config", { platformReady: false, connection: conn() }, "connected"],
    ["token scaduto", { platformReady: true, connection: conn({ status: "reconnect_required" }) }, "reconnect_required"],
    ["coexistence tagliata", { platformReady: true, connection: conn({ appDisconnectedAt: ago(5) }) }, "app_disconnected"],
    [
      "taglio + token scaduto → prima il taglio (ricollegare rinnova anche il token)",
      { platformReady: true, connection: conn({ status: "reconnect_required", appDisconnectedAt: ago(5) }) },
      "app_disconnected",
    ],
  ])("%s → %s", (_n, input, expected) => {
    expect(guideState(input)).toBe(expected);
  });
});

describe("guideSteps", () => {
  it("non configurata: il passo 1 aspetta l'amministratore", () => {
    expect(guideSteps("not_configured", null)).toEqual({ connect: "blocked", confirm: "todo", test: "todo" });
  });
  it.each<GuideState>(["ready", "reconnect_required", "app_disconnected"])("%s: si parte dal passo 1", (s) => {
    expect(guideSteps(s, ago(1))).toEqual({ connect: "current", confirm: "todo", test: "todo" });
  });
  it("collegato senza messaggi: tocca alla prova", () => {
    expect(guideSteps("connected", null)).toEqual({ connect: "done", confirm: "done", test: "current" });
  });
  it("collegato con un messaggio ricevuto: tutto fatto", () => {
    expect(guideSteps("connected", ago(2))).toEqual({ connect: "done", confirm: "done", test: "done" });
  });
  it("messaggio PRIMA dell'ultimo collegamento (numero vecchio, prima di ricollegare): non conta", () => {
    expect(guideSteps("connected", ago(30), ago(10)).test).toBe("current");
    expect(guideSteps("connected", ago(10), ago(10)).test).toBe("current");
    expect(guideSteps("connected", ago(5), ago(10)).test).toBe("done");
  });
});

describe("reconnectVia (decisione Q3: mai coexistence con un clic su un numero manuale)", () => {
  it.each<[string, { platformReady: boolean; connection: GuideConnection | null }, "meta" | "manual" | null]>([
    ["collegata: niente da ricollegare", { platformReady: true, connection: conn() }, null],
    ["nessun numero: niente da ricollegare", { platformReady: true, connection: null }, null],
    ["coexistence da ricollegare, piattaforma pronta → Meta", { platformReady: true, connection: conn({ status: "reconnect_required" }) }, "meta"],
    ["coexistence tagliata, piattaforma pronta → Meta", { platformReady: true, connection: conn({ appDisconnectedAt: ago(5) }) }, "meta"],
    ["coexistence da ricollegare, piattaforma NON pronta → token", { platformReady: false, connection: conn({ status: "reconnect_required" }) }, "manual"],
    [
      "MANUALE da ricollegare, piattaforma pronta → token, mai Meta",
      { platformReady: true, connection: conn({ status: "reconnect_required", onboardingMode: "manual" }) },
      "manual",
    ],
    [
      "Embedded Signup senza app da ricollegare → token, mai Meta",
      { platformReady: true, connection: conn({ status: "reconnect_required", onboardingMode: "embedded" }) },
      "manual",
    ],
  ])("%s", (_n, input, expected) => {
    expect(reconnectVia(input)).toBe(expected);
  });
});

describe("connectionMode", () => {
  it("coexistence = app + CRM; manuale ed Embedded Signup senza app = API", () => {
    expect(connectionMode("coexistence")).toBe("coexistence");
    expect(connectionMode("manual")).toBe("api");
    expect(connectionMode("embedded")).toBe("api");
  });
});

describe("signatureState (contatori della PR #9)", () => {
  const sig = (
    over: Partial<Omit<SignatureInfo, "stats">> & { stats?: Partial<SignatureInfo["stats"]> }
  ): SignatureInfo => ({
    required: over.required ?? true,
    configured: over.configured ?? true,
    stats: { lastVerifiedAt: null, lastInvalidAt: null, invalidSinceBoot: 0, ...over.stats },
  });
  it("senza segreto: manca (o ambiente di prova con i mock)", () => {
    expect(signatureState(sig({ configured: false }))).toBe("missing");
    expect(signatureState(sig({ configured: false, required: false }))).toBe("test_mode");
  });
  it("segreto ma nessun evento: in attesa", () => {
    expect(signatureState(sig({}))).toBe("waiting");
  });
  it("verificata", () => {
    expect(signatureState(sig({ stats: { lastVerifiedAt: ago(3) } }))).toBe("verified");
  });
  it("solo rifiuti: rifiutata", () => {
    expect(signatureState(sig({ stats: { lastInvalidAt: ago(1), invalidSinceBoot: 4 } }))).toBe("rejected");
  });
  it("rifiuto PIÙ RECENTE dell'ultima verificata: rifiutata", () => {
    expect(
      signatureState(sig({ stats: { lastVerifiedAt: ago(10), lastInvalidAt: ago(1), invalidSinceBoot: 1 } }))
    ).toBe("rejected");
  });
  it("rifiuto vecchio e verificata dopo: verificata", () => {
    expect(
      signatureState(sig({ stats: { lastVerifiedAt: ago(1), lastInvalidAt: ago(10), invalidSinceBoot: 1 } }))
    ).toBe("verified");
  });
});

/* ------------------------------ vista ------------------------------ */

const verified: SignatureInfo = {
  required: true,
  configured: true,
  stats: { lastVerifiedAt: ago(5), lastInvalidAt: null, invalidSinceBoot: 0 },
};

const connection = (over: Partial<GuideConnection> = {}) => ({
  ...conn(over),
  phoneNumberId: "100000000000001",
  displayPhoneNumber: "+39 347 718 5235",
  verifiedName: "InsidersLab",
  // Collegato un'ora fa: i messaggi «di 2 minuti fa» contano, quelli di prima no.
  connectedAt: ago(60),
});

const STATES: Record<GuideState | "connected_waiting" | "reconnect_manual", WhatsappGuideStatus> = {
  not_configured: {
    platform: { ready: false, reason: "not_configured" },
    connection: null,
    signature: verified,
    lastInboundAt: null,
  },
  ready: { platform: { ready: true, reason: null }, connection: null, signature: verified, lastInboundAt: null },
  connected_waiting: {
    platform: { ready: true, reason: null },
    connection: connection(),
    signature: verified,
    lastInboundAt: null,
  },
  connected: {
    platform: { ready: true, reason: null },
    connection: connection(),
    signature: verified,
    lastInboundAt: ago(2),
  },
  reconnect_required: {
    platform: { ready: true, reason: null },
    connection: connection({ status: "reconnect_required" }),
    signature: verified,
    lastInboundAt: ago(60 * 24 * 3),
  },
  // Il numero di test di Meta (+1 555…), collegato a mano.
  reconnect_manual: {
    platform: { ready: true, reason: null },
    connection: {
      ...connection({ status: "reconnect_required", onboardingMode: "manual" }),
      displayPhoneNumber: "+1 555 000 1111",
      verifiedName: "Test Number",
    },
    signature: verified,
    lastInboundAt: ago(60),
  },
  app_disconnected: {
    platform: { ready: true, reason: null },
    connection: connection({ appDisconnectedAt: ago(30) }),
    signature: verified,
    lastInboundAt: ago(60 * 24 * 20),
  },
};

function render(status: WhatsappGuideStatus, locale: Locale): string {
  const messages = messagesFor(locale) as unknown as Record<string, unknown>;
  const t = ((key: string, vars?: Record<string, string | number>) => translate(messages, key, vars)) as never;
  return renderToStaticMarkup(
    createElement(WhatsappGuideView, {
      status,
      t,
      locale,
      now: NOW,
      onOpenAdvanced: () => undefined,
      renderConnect: (label?: string) => createElement("span", null, `[BOTTONE-META${label ? `:${label}` : ""}]`),
    })
  );
}

describe("WhatsappGuideView", () => {
  it.each(LOCALES.flatMap((l) => Object.keys(STATES).map((s) => [l, s] as const)))(
    "%s / %s: nessuna chiave cruda",
    (locale, state) => {
      const out = render(STATES[state as keyof typeof STATES], locale);
      expect(out).not.toMatch(/settings\.whatsapp\.|admin\.platform\./);
    }
  );

  it("non configurata: messaggio per l'amministratore, nessun pulsante, via d'uscita in Avanzate", () => {
    const out = render(STATES.not_configured, "it");
    expect(out).toContain('data-guide-state="not_configured"');
    expect(out).toContain("Il tuo amministratore deve completare la configurazione Meta");
    expect(out).not.toContain("[BOTTONE-META");
    expect(out).toContain("Apri Avanzate");
  });

  it("gateway Wapi: lo dice invece del generico", () => {
    const out = render({ ...STATES.not_configured, platform: { ready: false, reason: "wapi_gateway" } }, "it");
    expect(out).toContain("gateway Wapi");
  });

  it("pronta: il grande pulsante nel passo 1 con la frase sull'app che resta sul telefono", () => {
    const out = render(STATES.ready, "it");
    expect(out).toContain('data-guide-state="ready"');
    expect(out.split("[BOTTONE-META]").length - 1).toBe(1);
    expect(out).toContain("l&#x27;app WhatsApp Business resta sul telefono");
    expect(out).toContain("Condividi la cronologia");
  });

  it("collegata in attesa: striscia con numero, modalità e firma; passo 3 in attesa", () => {
    const out = render(STATES.connected_waiting, "it");
    expect(out).toContain("+39 347 718 5235");
    expect(out).toContain("InsidersLab");
    expect(out).toContain("App + CRM (coexistence)");
    expect(out).toContain("Verificata 5 minuti fa");
    expect(out).toContain("In attesa del primo messaggio");
    expect(out).not.toContain("[BOTTONE-META");
  });

  it("collegata, ma l'ultimo messaggio è di prima del collegamento: passo 3 ancora in attesa", () => {
    const out = render(
      { ...STATES.connected, lastInboundAt: ago(120), connection: { ...STATES.connected.connection!, connectedAt: ago(60) } },
      "it"
    );
    expect(out).toContain("In attesa del primo messaggio");
    expect(out).not.toContain("Ultimo messaggio ricevuto: 2 ore fa");
  });

  it("collegata con messaggio: «ultimo messaggio ricevuto» in diretta", () => {
    const out = render(STATES.connected, "it");
    expect(out).toContain("Ultimo messaggio ricevuto: 2 minuti fa");
    expect(out).toMatch(/data-step-status="done"[\s\S]*data-step-status="done"[\s\S]*data-step-status="done"/);
  });

  it("manuale da ricollegare: niente «Ricollega con Meta», messaggio chiaro e pulsante per il token", () => {
    const messages = messagesFor("it") as unknown as Record<string, unknown>;
    const t = ((key: string, vars?: Record<string, string | number>) => translate(messages, key, vars)) as never;
    const out = renderToStaticMarkup(
      createElement(WhatsappGuideView, {
        status: STATES.reconnect_manual,
        t,
        locale: "it",
        now: NOW,
        onOpenAdvanced: () => undefined,
        renderConnect: () => createElement("span", null, "[BOTTONE-META]"),
      })
    );
    expect(out).toContain('data-guide-state="reconnect_required"');
    expect(out).not.toContain("[BOTTONE-META");
    expect(out).not.toContain("Ricollega con Meta");
    expect(out).toContain("Questo numero è collegato a mano");
    expect(out).toContain("Incolla un token nuovo");
    expect(out).toContain('data-reconnect="manual"');
    expect(out).toContain("Solo API");
  });

  it.each([
    ["reconnect_required", "Il token di WhatsApp è scaduto"],
    ["app_disconnected", "Meta ha scollegato il numero dal CRM"],
  ] as const)("%s: allerta rossa con «Ricollega con Meta» e alternativa manuale", (state, title) => {
    const out = render(STATES[state], "it");
    expect(out).toContain('role="alert"');
    expect(out).toContain(title);
    expect(out).toContain("[BOTTONE-META:Ricollega con Meta]");
    expect(out).toContain("Oppure incolla un token nuovo in Avanzate");
  });

  it("coexistence da ricollegare con piattaforma non pronta: solo la via del token, con il perché", () => {
    const out = render({ ...STATES.reconnect_required, platform: { ready: false, reason: "not_configured" } }, "it");
    expect(out).not.toContain("[BOTTONE-META");
    expect(out).toContain("Incolla un token nuovo");
    expect(out).toContain("serve la configurazione Meta della piattaforma");
    const cut = render({ ...STATES.app_disconnected, platform: { ready: false, reason: "not_configured" } }, "it");
    expect(cut).toContain("serve la configurazione Meta della piattaforma");
    // Il testo «collegato a mano» è solo per le connessioni manuali.
    expect(out).not.toContain("Questo numero è collegato a mano");
  });

  it("senza numero la firma nella striscia è «—» (il valore d'istanza sta in /admin)", () => {
    for (const state of ["not_configured", "ready"] as const) {
      const out = render(STATES[state], "it");
      expect(out).toMatch(/data-testid="guide-signature">—</);
      expect(out).not.toContain("Verificata");
    }
    expect(render(STATES.connected, "it")).toMatch(/data-testid="guide-signature">Verificata/);
  });

  it("firma: manca il segreto → avviso nella striscia", () => {
    const out = render(
      { ...STATES.connected, signature: { ...verified, configured: false } },
      "it"
    );
    expect(out).toContain("Manca l&#x27;App Secret");
  });

  it("la vista non contiene segreti (non le arrivano: lo stato non li porta)", () => {
    const keys = JSON.stringify(Object.keys(STATES.connected.connection!).sort());
    expect(keys).not.toMatch(/token|secret/i);
  });
});

describe("«Collega un altro numero con Meta» in Avanzate (revisione PR #15)", () => {
  function renderAnother(status: WhatsappGuideStatus): string {
    const messages = messagesFor("it") as unknown as Record<string, unknown>;
    const t = ((key: string, vars?: Record<string, string | number>) => translate(messages, key, vars)) as never;
    return renderToStaticMarkup(
      createElement(AnotherNumberWithMeta, {
        status,
        t,
        renderConnect: (label?: string, confirm?: string) =>
          createElement("span", null, `[BOTTONE-META:${label}|${confirm}]`),
      })
    );
  }

  it.each<[string, WhatsappGuideStatus, boolean]>([
    ["collegata, piattaforma pronta → sì", STATES.connected, true],
    ["collegata, piattaforma NON pronta → no", { ...STATES.connected, platform: { ready: false, reason: "not_configured" } }, false],
    ["nessun numero → no (c'è già il pulsante del passo 1)", STATES.ready, false],
    ["coexistence da ricollegare → no (c'è già «Ricollega con Meta» in alto)", STATES.reconnect_required, false],
    ["manuale da ricollegare → sì, ma come «altro numero» con conferma, mai come «Ricollega»", STATES.reconnect_manual, true],
  ])("%s", (_n, status, visible) => {
    expect(canConnectAnotherNumber({ platformReady: status.platform.ready, connection: status.connection })).toBe(visible);
    const out = renderAnother(status);
    if (!visible) {
      expect(out).toBe("");
      return;
    }
    expect(out).toContain("[BOTTONE-META:Collega un altro numero con Meta|");
    expect(out).toContain("SOSTITUISCE");
    expect(out).not.toContain("Ricollega");
  });

  it("la conferma nomina il numero che verrà sostituito", () => {
    expect(renderAnother(STATES.reconnect_manual)).toContain("SOSTITUISCE +1 555 000 1111");
  });
});

describe("accessibilità (revisione PR #15)", () => {
  it("una sola regione viva, vuota finché non arriva un messaggio; «X fa» non è viva", () => {
    const out = render(STATES.connected, "it");
    expect(out.match(/aria-live/g)).toHaveLength(1);
    expect(out).toMatch(/data-testid="guide-announcement"><\/p>/);
    expect(out).not.toMatch(/aria-live="polite"[^>]*data-testid="guide-last-inbound"/);
  });

  it("all'arrivo di un messaggio la regione viva lo annuncia", () => {
    const messages = messagesFor("it") as unknown as Record<string, unknown>;
    const t = ((key: string, vars?: Record<string, string | number>) => translate(messages, key, vars)) as never;
    const out = renderToStaticMarkup(
      createElement(WhatsappGuideView, {
        status: STATES.connected,
        t,
        locale: "it",
        now: NOW,
        announcement: "Nuovo messaggio ricevuto.",
        onOpenAdvanced: () => undefined,
        renderConnect: () => null,
      })
    );
    expect(out).toContain('data-testid="guide-announcement">Nuovo messaggio ricevuto.</p>');
  });
});
