import { createHmac, timingSafeEqual } from "node:crypto";
import { SendError } from "@/server/channels/errors";
import type {
  ChannelAdapter,
  ContactRef,
  InboundEvent,
  OutboundMessage,
  SendContext,
} from "@/server/channels/types";

/**
 * 005-livello-canali (M1.3, T023) — `FakeChannelAdapter`, SOLO nei test.
 *
 * Un canale inventato, scritto come lo scriverebbe chi aggiunge un canale nuovo
 * (ADR §3.6): un webhook proprio (`/api/webhooks/fake/<token>`), firma HMAC
 * obbligatoria e fail-closed, identità con ambito di account (come IGSID),
 * niente modelli, finestra di 48 h, un trasporto in memoria.
 *
 * Valore di `channel`: "messenger". Il CHECK di R1 su `message.channel` e
 * `channel_account.channel` ammette solo i quattro canali dell'ADR, e il finto
 * non deve cambiare lo schema: prende in prestito un valore ammesso e non
 * ancora usato da nessun codice (registro M1.3, «Adattatore finto»). Lo slug,
 * l'unica cosa che il nucleo usa per instradare, è `fake`.
 */

export const FAKE_TOKEN = "fake-webhook-token-0000000000000001";
export const FAKE_SECRET = "fake-signing-secret-0001";
export const FAKE_SIGNATURE_HEADER = "x-fake-signature";

export function fakeSign(raw: string | Uint8Array): string {
  const h = createHmac("sha256", FAKE_SECRET);
  if (typeof raw === "string") h.update(raw, "utf8");
  else h.update(raw);
  return `sha256=${h.digest("hex")}`;
}

type FakeWireEvent =
  | { type: "message"; id: string; from: string; name?: string; text?: string; at?: number }
  | { type: "echo"; id: string; to: string; text?: string; at?: number }
  | { type: "status"; id: string; status: string };

/** Payload del provider finto. */
export type FakePayload = { fake: true; account: string; events: FakeWireEvent[] };

/** Trasporto in memoria del canale finto (lo azzera ogni test). */
export const fakeTransport = {
  sent: [] as { account: string; to: string; message: OutboundMessage }[],
  fail: null as null | "auth" | "down" | "bad",
  seq: 0,
  reset() {
    this.sent = [];
    this.fail = null;
    this.seq = 0;
  },
};

const at = (s: unknown): Date | null =>
  typeof s === "number" && Number.isFinite(s) && s > 0 ? new Date(s * 1000) : null;

function contact(id: string, name?: string): ContactRef {
  return { externalId: id, phone: null, providerUserId: id, displayName: name ?? null };
}

export const fakeAdapter: ChannelAdapter = {
  channel: "messenger",
  webhookSlug: "fake",
  capabilities: {
    replyWindow: { kind: "rolling", ms: 48 * 60 * 60 * 1000 },
    templates: "none",
    inboundMedia: [],
    outboundMedia: { kinds: [], maxBytes: {} },
    maxTextLength: 640,
    threads: "single",
    echoes: true,
    typingIndicator: false,
    readReceipts: false,
    identityScope: "account",
  },
  webhook: {
    expectedToken: () => FAKE_TOKEN,
    verifySignature(rawBody, headers) {
      const got = headers.get(FAKE_SIGNATURE_HEADER);
      if (!got) return false;
      const want = fakeSign(rawBody);
      const a = Buffer.from(got);
      const b = Buffer.from(want);
      return a.length === b.length && timingSafeEqual(a, b);
    },
    parse(payload) {
      if (!payload || typeof payload !== "object") return [];
      const p = payload as Partial<FakePayload>;
      if (p.fake !== true || typeof p.account !== "string" || !Array.isArray(p.events)) return [];
      const account = { by: "account" as const, externalAccountId: p.account };
      const out: InboundEvent[] = [];
      for (const e of p.events) {
        if (!e || typeof e !== "object" || typeof e.id !== "string") continue;
        if (e.type === "message" && typeof e.from === "string") {
          out.push({
            kind: "message",
            channel: "messenger",
            account,
            externalMessageId: e.id,
            occurredAt: at(e.at),
            from: contact(e.from, e.name),
            content: { type: "text", text: e.text ?? null, media: null },
          });
        } else if (e.type === "echo" && typeof e.to === "string") {
          out.push({
            kind: "echo",
            channel: "messenger",
            account,
            externalMessageId: e.id,
            occurredAt: at(e.at),
            to: contact(e.to),
            content: { type: "text", text: e.text ?? null, media: null },
          });
        } else if (
          e.type === "status" &&
          ["sent", "delivered", "read", "failed"].includes(e.status)
        ) {
          out.push({
            kind: "status",
            channel: "messenger",
            account,
            externalMessageId: e.id,
            status: e.status as "sent" | "delivered" | "read" | "failed",
          });
        } else {
          out.push({ kind: "ignored", channel: "messenger", reason: "unsupported_type", externalMessageId: e.id });
        }
      }
      return out;
    },
  },
  async send(ctx: SendContext, message: OutboundMessage) {
    if (fakeTransport.fail === "auth") {
      await ctx.markReconnectRequired();
      throw new SendError("reconnect_required", "token del canale finto scaduto");
    }
    if (fakeTransport.fail === "down") throw new SendError("meta_unavailable", "canale finto giù");
    if (fakeTransport.fail === "bad") throw new SendError("meta_error", "richiesta rifiutata");
    fakeTransport.seq += 1;
    fakeTransport.sent.push({ account: ctx.account.externalAccountId, to: ctx.recipient.externalId, message });
    return { externalMessageId: `fake.out.${fakeTransport.seq}` };
  },
  async checkHealth(ctx) {
    return { status: ctx.account.status };
  },
};
