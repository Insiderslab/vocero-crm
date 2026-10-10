import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Fixtures SINTÉTICAS del webhook de WhatsApp (005-livello-canali, T004, D12).
 *
 * Origen: la forma de los payloads de `src/server/dev/wa-mock-inbound.ts`
 * (`buildInboundPayload`, `buildEchoPayload`, `buildStatusPayload`,
 * `buildTemplateStatusPayload`) y la documentada por Meta para los campos
 * `messages`, `smb_message_echoes`, `message_template_status_update`,
 * `history`, `smb_app_state_sync` y `account_update` (Cloud API, webhooks).
 * Ningún payload viene de producción ni de una cuenta real: números, wamid,
 * BSUID y media id son inventados.
 *
 * Constantes:
 * - org A: WABA `200000000000001`, phone_number_id `100000000000001`,
 *   número `525510000001`; org B: `200000000000002` / `100000000000002`.
 * - Clientes: `5215512345678` (móvil MX con el «1» extra → identidad
 *   `525512345678`), `5215587654321`, `5215511112222`; BSUID
 *   `MX.1000000000000000001`.
 * - Fechas relativas al reloj fijo de los golden (2030-01-01T12:00:00Z,
 *   `FIXED_NOW_S` en normalize.ts): p. ej. `1893499140` = ahora − 60 s.
 * - Media id con `gone` → Graph responde 404 (adjunto roto).
 *
 * Son JSON planos para que M1.3 (T024) los reutilice en los golden puros de
 * `whatsappAdapter.webhook.parse()`.
 */

export type FixtureName =
  | "inbound-text-mx"
  | "inbound-text-mx-again"
  | "inbound-text-b"
  | "inbound-old-text"
  | "inbound-bsuid-only"
  | "inbound-phone-and-bsuid"
  | "inbound-duplicate"
  | "inbound-image"
  | "inbound-document"
  | "inbound-location"
  | "inbound-contacts"
  | "inbound-broken-media"
  | "inbound-unsupported"
  | "inbound-no-identity"
  | "inbound-multi"
  | "status-sent-delivered-read"
  | "status-delivered-late"
  | "status-failed"
  | "status-a-wamid-on-b"
  | "status-and-message"
  | "echo-text"
  | "echo-image"
  | "echo-no-to"
  | "echo-messages-key"
  | "template-status-approved"
  | "template-status-rejected-b"
  | "unknown-phone-number-id"
  | "unknown-field"
  | "history-two-threads"
  | "history-declined"
  | "state-sync"
  | "account-update-partner-removed-a"
  | "account-update-offboarded-waba"
  | "account-update-reconnected"
  | "account-update-other-event";

export function waFixture(name: FixtureName): unknown {
  return JSON.parse(readFileSync(path.join(import.meta.dirname, `${name}.json`), "utf8"));
}
