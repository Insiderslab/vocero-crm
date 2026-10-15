import { and, eq, isNull, max, notInArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { unsignedWebhookAllowed } from "@/lib/dev-guard";
import { getEnv } from "@/lib/env";
import type { GuideConnection, SignatureInfo } from "@/lib/whatsapp-guide";
import { webhookSignatureStats } from "@/server/inbox/webhook-signature-stats";
import { DEMO_PHONES } from "@/server/seed/demo";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { getEmbeddedSignupConfig } from "@/server/whatsapp/embedded-signup";

/**
 * 013 — Tutto quello che serve alla pagina guidata di Configurazione →
 * WhatsApp in una lettura: la piattaforma è pronta? quale numero è collegato
 * e in che stato? la firma del webhook arriva verificata? quando è arrivato
 * l'ultimo messaggio? Niente segreti: né token (nemmeno le ultime 4 cifre),
 * né App Secret, né il segmento segreto della URL del webhook.
 */

export type WhatsappGuideStatus = {
  platform: { ready: boolean; reason: "not_configured" | "wapi_gateway" | null };
  connection:
    | (GuideConnection & {
        phoneNumberId: string;
        displayPhoneNumber: string | null;
        verifiedName: string | null;
        /** Ultimo collegamento o aggiornamento della connessione (ISO): il passo 3 vale dopo. */
        connectedAt: string | null;
      })
    | null;
  signature: SignatureInfo;
  /**
   * Ultimo messaggio vero ricevuto, ISO: solo conversazioni reali (non
   * Laboratorio) sull'account WhatsApp ATTUALE dell'organizzazione, senza i
   * contatti della demo. `conversation.last_inbound_at` lo scrive solo
   * l'ingestione di un messaggio nuovo (non lo storico della coexistence).
   */
  lastInboundAt: string | null;
};

export async function getWhatsappGuideStatus(organizationId: string): Promise<WhatsappGuideStatus> {
  const env = getEnv();
  const c = schema.conversation;
  const [es, creds, last, mc] = await Promise.all([
    getEmbeddedSignupConfig(),
    getCredentialsByOrg(organizationId),
    getDb()
      .select({ at: max(c.lastInboundAt) })
      .from(c)
      .innerJoin(
        schema.contact,
        and(eq(schema.contact.id, c.contactId), eq(schema.contact.organizationId, c.organizationId))
      )
      .where(
        scoped(
          c.organizationId,
          organizationId,
          sql`${c.isTest} = false`,
          // L'account WhatsApp attuale (uno per organizzazione), scritto a mano
          // per non dipendere dagli helper dei canali che la PR #14 rifà.
          sql`${c.channelAccountId} = (select ca.id from channel_account ca
                where ca.organization_id = ${organizationId} and ca.channel = 'whatsapp')`,
          or(isNull(schema.contact.phone), notInArray(schema.contact.phone, DEMO_PHONES))
        )
      ),
    getDb()
      .select({ updatedAt: schema.metaCredentials.updatedAt })
      .from(schema.metaCredentials)
      .where(scoped(schema.metaCredentials.organizationId, organizationId))
      .limit(1),
  ]);
  const lastInbound = last[0]?.at ?? null;
  return {
    platform: {
      ready: es.enabled,
      reason: es.enabled ? null : env.WAPI_BASE_URL ? "wapi_gateway" : "not_configured",
    },
    connection: creds
      ? {
          phoneNumberId: creds.phoneNumberId,
          displayPhoneNumber: creds.displayPhoneNumber,
          verifiedName: creds.verifiedName,
          status: creds.status,
          onboardingMode: creds.onboardingMode,
          appDisconnectedAt: creds.appDisconnectedAt?.toISOString() ?? null,
          connectedAt: mc[0]?.updatedAt ? new Date(mc[0].updatedAt).toISOString() : null,
        }
      : null,
    signature: {
      required: !unsignedWebhookAllowed(),
      configured: Boolean(env.META_APP_SECRET),
      stats: webhookSignatureStats(),
    },
    lastInboundAt: lastInbound ? new Date(lastInbound).toISOString() : null,
  };
}
