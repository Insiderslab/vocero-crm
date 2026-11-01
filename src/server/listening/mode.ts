import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { SendError } from "@/server/channels/errors";

/**
 * 016 — Modalità ascolto: UNICA fonte della regola.
 *
 * Con la modalità accesa Orbit non invia nulla da solo a un cliente finale
 * (agente AI, automazioni, cervello esterno). Le risposte delle persone dalla
 * Posta restano libere: sono il materiale che Heili Core studia. Chi decide
 * se un invio automatico è permesso chiama `isListeningMode` e basta: nessun
 * altro punto del codice conosce la tabella.
 *
 * Fail-closed: se la lettura fallisce l'errore sale al chiamante (un invio
 * automatico non parte "nel dubbio"). Tutto filtra per l'organizzazione.
 */

export type ListeningState = { enabled: boolean; enabledAt: Date | null };

/** Stato dell'organizzazione (nessuna riga = spento). */
export async function getListeningState(organizationId: string): Promise<ListeningState> {
  const rows = await getDb()
    .select({
      enabled: schema.listeningMode.enabled,
      enabledAt: schema.listeningMode.enabledAt,
    })
    .from(schema.listeningMode)
    .where(scoped(schema.listeningMode.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? { enabled: false, enabledAt: null };
}

/** ¿La modalità ascolto è accesa per questa organizzazione? */
export async function isListeningMode(organizationId: string): Promise<boolean> {
  return (await getListeningState(organizationId)).enabled;
}

/** Errore tipato per gli invii automatici bloccati (HTTP 409 nelle rotte). */
export function listeningModeError(): SendError {
  return new SendError(
    "listening_mode",
    "Modalità ascolto attiva: Orbit non invia messaggi da solo"
  );
}

/** Accende/spegne. `enabled_at` = ultima accensione; resta quando si spegne. */
export async function setListeningMode(
  organizationId: string,
  enabled: boolean,
  userId: string
): Promise<ListeningState> {
  const now = new Date();
  const rows = await getDb()
    .insert(schema.listeningMode)
    .values({
      id: newId("listeningMode"),
      organizationId,
      enabled,
      enabledAt: enabled ? now : null,
      enabledBy: userId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.listeningMode.organizationId,
      set: {
        enabled,
        // Già accesa: l'ora della prima accensione non si sposta.
        ...(enabled
          ? {
              enabledAt: sql`case when ${schema.listeningMode.enabled} then ${schema.listeningMode.enabledAt} else ${now.toISOString()}::timestamp end`,
            }
          : {}),
        enabledBy: userId,
        updatedAt: now,
      },
    })
    .returning({
      enabled: schema.listeningMode.enabled,
      enabledAt: schema.listeningMode.enabledAt,
    });
  return rows[0]!;
}
