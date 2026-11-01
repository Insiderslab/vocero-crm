import { eq } from "drizzle-orm";
import { scheduleAgentTurn } from "@/server/ai/pipeline";
import { getDb, schema } from "@/lib/db";
import { isAiConfigured } from "@/lib/env";
import { isListeningMode } from "@/server/listening/mode";

/**
 * Punto de enganche del turno del agente tras la ingesta de un mensaje
 * entrante REAL (las conversaciones del Laboratorio invocan el pipeline
 * directamente, sin debounce).
 *
 * 016: con la modalità ascolto accesa il turno NON si pianifica (nessuna
 * chiamata al modello, nessun costo). L'organizzazione si legge dalla riga
 * della conversazione (chiave primaria), poi la regola è di `listening/mode`.
 */
export async function maybeRunAgentTurn(
  conversationId: string
): Promise<void> {
  if (!isAiConfigured()) return;
  const rows = await getDb()
    .select({ organizationId: schema.conversation.organizationId })
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const organizationId = rows[0]?.organizationId;
  // Conversazione sparita: niente da fare. In ascolto: nessun turno.
  if (!organizationId || (await isListeningMode(organizationId))) return;
  scheduleAgentTurn(conversationId);
}
