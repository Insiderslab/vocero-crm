import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { SendError } from "@/server/channels/errors";
import type {
  ChannelAdapter,
  InboundEvent,
  MediaKind,
  OutboundMessage,
  SendContext,
} from "@/server/channels/types";

/**
 * 005-livello-canali (M1.3, T022) — Suite di contratto comune (plan §7.2).
 *
 * La eseguono TUTTI gli adattatori (WhatsApp, il finto dei test e, in M1.6,
 * Instagram) con le stesse asserzioni:
 * - `parse` puro: nessun `fetch`, nessun accesso al DB (spia passata dal file
 *   di test, che sostituisce `@/lib/db`), nessuna dipendenza dall'orologio
 *   (stesso risultato con due orologi diversi);
 * - ordine degli eventi;
 * - payload illeggibile → `[]`;
 * - firma valida, errata, assente;
 * - `send` restituisce `externalMessageId` e mappa gli errori in `SendError`
 *   (con `reconnect_required` → il nucleo marca l'account, via contesto);
 * - capacità coerenti (`templates: "none"` ⇒ nessun `template_status`).
 */

const KINDS = ["whatsapp", "instagram", "messenger", "email"];
const MEDIA_KINDS: readonly MediaKind[] = [
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "location",
  "contacts",
];

export type ContractFixtures = {
  /** Spia del DB del file di test (`vi.mock("@/lib/db")`): non deve essere chiamata da `parse`. */
  dbAccess: Mock;
  /** Payload validi del canale (tutti devono dare almeno un evento). */
  payloads: { name: string; payload: unknown }[];
  /** Un payload con eventi di tipo diverso e l'ORDINE atteso dei loro `kind`. */
  ordered: { payload: unknown; kinds: InboundEvent["kind"][] };
  signature: {
    rawBody: string;
    valid: Record<string, string>;
    invalid: Record<string, string>;
  };
  send: {
    /** Contesto d'invio; `markReconnectRequired` deve essere una spia. */
    ctx(): SendContext & { markReconnectRequired: Mock };
    message: OutboundMessage;
    /** Prepara il trasporto finto per un invio riuscito. */
    arrangeOk(): void;
    externalMessageId: string;
    failures: { name: string; arrange(): void; code: SendError["code"] }[];
  };
};

export function runContractSuite(adapter: ChannelAdapter, fx: ContractFixtures): void {
  describe(`contratto ChannelAdapter — ${adapter.channel} (/${adapter.webhookSlug})`, () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      fx.dbAccess.mockClear();
    });

    it("identità: canale previsto e slug valido per un segmento di URL", () => {
      expect(KINDS).toContain(adapter.channel);
      expect(adapter.webhookSlug).toMatch(/^[a-z][a-z0-9-]*$/);
    });

    it("parse è puro: niente fetch, niente DB, niente orologio", () => {
      const fetchSpy = vi.fn(() => {
        throw new Error("parse ha chiamato fetch");
      });
      vi.stubGlobal("fetch", fetchSpy);
      vi.useFakeTimers({ toFake: ["Date"] });
      for (const { name, payload } of fx.payloads) {
        vi.setSystemTime(new Date("2031-05-05T05:05:05Z"));
        const first = adapter.webhook.parse(structuredClone(payload));
        vi.setSystemTime(new Date("2040-12-31T23:59:59Z"));
        const second = adapter.webhook.parse(structuredClone(payload));
        expect(second, name).toEqual(first);
        expect(first.length, `${name}: nessun evento`).toBeGreaterThan(0);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(fx.dbAccess).not.toHaveBeenCalled();
    });

    it("parse non modifica il payload ricevuto", () => {
      for (const { name, payload } of fx.payloads) {
        const copy = structuredClone(payload);
        adapter.webhook.parse(copy);
        expect(copy, name).toEqual(payload);
      }
    });

    it("ordine degli eventi = ordine di elaborazione", () => {
      const kinds = adapter.webhook.parse(fx.ordered.payload).map((e) => e.kind);
      expect(kinds).toEqual(fx.ordered.kinds);
    });

    it("payload illeggibile → [] (mai un'eccezione)", () => {
      for (const bad of [null, undefined, 0, "x", [], {}, { entry: "no" }, { entry: [null, 1] }]) {
        expect(adapter.webhook.parse(bad), JSON.stringify(bad)).toEqual([]);
      }
    });

    it("ogni evento porta il canale dell'adattatore", () => {
      for (const { payload } of fx.payloads) {
        for (const event of adapter.webhook.parse(payload)) {
          expect(event.channel).toBe(adapter.channel);
        }
      }
    });

    it("firma: valida → true; errata → false; assente → false", () => {
      const { rawBody, valid, invalid } = fx.signature;
      expect(adapter.webhook.verifySignature(rawBody, new Headers(valid))).toBe(true);
      expect(adapter.webhook.verifySignature(Buffer.from(rawBody, "utf8"), new Headers(valid))).toBe(true);
      expect(adapter.webhook.verifySignature(rawBody, new Headers(invalid))).toBe(false);
      expect(adapter.webhook.verifySignature(rawBody, new Headers())).toBe(false);
      expect(adapter.webhook.verifySignature(`${rawBody} `, new Headers(valid))).toBe(false);
    });

    it("token del webhook: mai vuoto quando il canale è configurato", () => {
      expect(adapter.webhook.expectedToken().length).toBeGreaterThan(0);
    });

    it("send → externalMessageId del provider", async () => {
      fx.send.arrangeOk();
      const ctx = fx.send.ctx();
      const out = await adapter.send(ctx, fx.send.message);
      expect(out).toEqual({ externalMessageId: fx.send.externalMessageId });
      expect(ctx.markReconnectRequired).not.toHaveBeenCalled();
    });

    it("send: ogni errore del provider diventa SendError con il codice di oggi", async () => {
      expect(fx.send.failures.length).toBeGreaterThan(0);
      for (const failure of fx.send.failures) {
        failure.arrange();
        const ctx = fx.send.ctx();
        const err = await adapter.send(ctx, fx.send.message).then(
          () => null,
          (e: unknown) => e
        );
        expect(err, failure.name).toBeInstanceOf(SendError);
        expect((err as SendError).code, failure.name).toBe(failure.code);
        // L'account si marca SOLO per un token scaduto, e solo dal contesto
        // del nucleo (l'adattatore non scrive nel DB).
        expect(ctx.markReconnectRequired, failure.name).toHaveBeenCalledTimes(
          failure.code === "reconnect_required" ? 1 : 0
        );
      }
      expect(fx.dbAccess).not.toHaveBeenCalled();
    });

    it("capacità coerenti", () => {
      const c = adapter.capabilities;
      if (c.replyWindow.kind === "rolling") expect(c.replyWindow.ms).toBeGreaterThan(0);
      expect(c.maxTextLength).toBeGreaterThan(0);
      for (const k of [...c.inboundMedia, ...c.outboundMedia.kinds]) expect(MEDIA_KINDS).toContain(k);
      for (const [k, max] of Object.entries(c.outboundMedia.maxBytes)) {
        expect(c.outboundMedia.kinds, k).toContain(k);
        expect(max).toBeGreaterThan(0);
      }
      expect(["organization", "account"]).toContain(c.identityScope);
      if (!c.echoes) {
        for (const { payload } of fx.payloads) {
          expect(adapter.webhook.parse(payload).some((e) => e.kind === "echo")).toBe(false);
        }
      }
      if (c.templates === "none") {
        for (const { payload } of fx.payloads) {
          expect(adapter.webhook.parse(payload).some((e) => e.kind === "template_status")).toBe(false);
        }
      }
      if (!c.typingIndicator && !c.readReceipts) expect(adapter.markReadAndTyping).toBeUndefined();
    });

    it("eventi con account: sempre un riferimento non vuoto (il nucleo sceglie l'organizzazione)", () => {
      for (const { payload } of fx.payloads) {
        for (const e of adapter.webhook.parse(payload)) {
          if (!("account" in e)) continue;
          const id = e.account.by === "account" ? e.account.externalAccountId : e.account.externalParentId;
          expect(typeof id).toBe("string");
          expect(id.length).toBeGreaterThan(0);
        }
      }
    });
  });
}
