import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { authenticateBot } from "@/server/bot/auth";
import { accountContext, findAccountForOrg } from "@/server/channels/core/accounts";
import { whatsappAdapter } from "@/server/channels/whatsapp/adapter";
import { isListeningMode, listeningModeError } from "@/server/listening/mode";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ conversationId: z.string().min(1) });

/**
 * Indicador "escribiendo…" + marcar leído el último inbound.
 * POST /api/bot/typing {conversationId}
 *
 * Best-effort por contrato: al bot JAMÁS le vale reintentar esto — si Meta
 * falla se responde 200 {ok:false} y la conversación sigue. El indicador
 * dura hasta ~25 s o hasta que llegue la respuesta real.
 */
export async function POST(req: Request) {
  const auth = await authenticateBot(req);
  if (auth instanceof Response) return auth;
  const { organizationId } = auth;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  // 016: in ascolto né «letto» né «sta scrivendo»: sarebbe un segnale al cliente.
  if (await isListeningMode(organizationId)) {
    return apiError(409, "listening_mode", listeningModeError().message);
  }

  const db = getDb();
  const convs = await db
    .select()
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");
  if (conv.isTest) {
    // Sandbox: jamás toca la API real (guardrail del Laboratorio).
    return Response.json({ ok: false, reason: "sandbox" });
  }
  if (!conv.aiEnabled || conv.handoffAt) {
    // Handoff/IA pausada: un humano atiende — "escribiendo…" aquí sería
    // mentirle al cliente. Se omite sin tocar Meta.
    return Response.json({ ok: false, reason: "ai_paused" });
  }

  // 005 (R2): el último ID externo entrante de WhatsApp (= wamid, V5).
  const msgs = await db
    .select({ externalMessageId: schema.message.externalMessageId })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conv.id),
        eq(schema.message.direction, "in"),
        eq(schema.message.channel, "whatsapp"),
        isNotNull(schema.message.externalMessageId)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(1);
  const wamid = msgs[0]?.externalMessageId;
  if (!wamid) return Response.json({ ok: false, reason: "no_inbound" });

  const account = await findAccountForOrg(organizationId, "whatsapp");
  if (!account) {
    return apiError(409, "no_connection", "WhatsApp no está conectado");
  }

  try {
    // «Leído» + «escribiendo…»: la capacidad del adaptador (mismo cuerpo a Graph).
    await whatsappAdapter.markReadAndTyping!(accountContext(account), wamid);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, reason: "meta_error" });
  }
}
