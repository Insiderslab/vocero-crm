import { max, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { unsignedWebhookAllowed } from "@/lib/dev-guard";
import { getEnv } from "@/lib/env";
import type { GuideConnection, SignatureInfo } from "@/lib/whatsapp-guide";
import { webhookSignatureStats } from "@/server/inbox/webhook-signature-stats";
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
      })
    | null;
  signature: SignatureInfo;
  /** Ultimo messaggio vero ricevuto (non Laboratorio), ISO. */
  lastInboundAt: string | null;
};

export async function getWhatsappGuideStatus(organizationId: string): Promise<WhatsappGuideStatus> {
  const env = getEnv();
  const [es, creds, last] = await Promise.all([
    getEmbeddedSignupConfig(),
    getCredentialsByOrg(organizationId),
    getDb()
      .select({ at: max(schema.conversation.lastInboundAt) })
      .from(schema.conversation)
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          sql`${schema.conversation.isTest} = false`
        )
      ),
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
