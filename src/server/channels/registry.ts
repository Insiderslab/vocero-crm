import type { ChannelAdapter, ChannelKind } from "@/server/channels/types";
import { whatsappAdapter } from "@/server/channels/whatsapp/adapter";
import {
  processAccountUpdateValue,
  processHistoryValue,
  processStateSyncValue,
} from "@/server/inbox/coexistence";
import type { WebhookValue } from "@/server/inbox/webhook";

/**
 * 005-livello-canali (M1.3, T026) — Registro de canales: slug del webhook →
 * adaptador. Añadir un canal = una línea aquí (ADR §3.6). En M1.3 solo
 * WhatsApp (slug histórico `wa`); el filtro de instancia `CHANNELS_ENABLED`
 * llega con el segundo canal (M1.6, T048).
 *
 * `providerEvents`: gestores de los eventos `provider` del canal, es decir lo
 * que el núcleo NO modela (WhatsApp coexistence 009: historial, agenda,
 * corte de la coexistence). Siguen en `src/server/inbox/coexistence.ts` tal
 * cual (domanda aperta Q1 del registro M1.3).
 */

export type ProviderEventHandler = (event: {
  parentId: string | null;
  payload: unknown;
}) => Promise<void>;

export type ChannelRegistration = {
  adapter: ChannelAdapter;
  providerEvents?: Readonly<Record<string, ProviderEventHandler>>;
};

const WHATSAPP: ChannelRegistration = {
  adapter: whatsappAdapter,
  providerEvents: {
    history: ({ payload }) => processHistoryValue(payload as WebhookValue),
    smb_app_state_sync: ({ payload }) => processStateSyncValue(payload as WebhookValue),
    account_update: ({ parentId, payload }) =>
      processAccountUpdateValue(parentId, payload as WebhookValue),
  },
};

const REGISTRY: readonly ChannelRegistration[] = [WHATSAPP];

/** Búsqueda inyectable (los tests registran su adaptador falso sin tocar este archivo). */
export type ChannelLookup = {
  bySlug(slug: string): ChannelRegistration | null;
  byChannel(channel: ChannelKind): ChannelRegistration | null;
};

export const channelRegistry: ChannelLookup = {
  bySlug: (slug) => REGISTRY.find((r) => r.adapter.webhookSlug === slug) ?? null,
  byChannel: (channel) => REGISTRY.find((r) => r.adapter.channel === channel) ?? null,
};
