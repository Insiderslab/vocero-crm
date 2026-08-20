import { and, asc, eq, gte } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { csvResponse, toCsv } from "@/lib/csv";
import { getDb, schema } from "@/lib/db";
import { parseFormat } from "@/server/export/auth";
import { withExport } from "@/server/export/handler";

export const dynamic = "force-dynamic";

/**
 * Extracción de mensajes. Filtros: `?conversation=<id>` (una conversación) y
 * `?since=<ISO 8601>` (incremental para análisis periódico). Tope de 5000 por
 * llamada — para históricos grandes se pagina con `since`.
 */
export const GET = withExport(async (org, url) => {
  const conversationId = url.searchParams.get("conversation")?.trim();
  const sinceRaw = url.searchParams.get("since")?.trim();
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (sinceRaw && (!since || Number.isNaN(since.getTime()))) {
    return apiError(422, "invalid_since", "since debe ser fecha ISO 8601");
  }

  const db = getDb();
  const messages = await db
    .select({
      id: schema.message.id,
      conversationId: schema.message.conversationId,
      direction: schema.message.direction,
      type: schema.message.type,
      text: schema.message.text,
      status: schema.message.status,
      aiGenerated: schema.message.aiGenerated,
      origin: schema.message.origin,
      waTimestamp: schema.message.waTimestamp,
      createdAt: schema.message.createdAt,
    })
    .from(schema.message)
    .innerJoin(
      schema.conversation,
      eq(schema.message.conversationId, schema.conversation.id)
    )
    .where(
      and(
        eq(schema.message.organizationId, org.id),
        eq(schema.conversation.isTest, false),
        conversationId
          ? eq(schema.message.conversationId, conversationId)
          : undefined,
        since ? gte(schema.message.createdAt, since) : undefined
      )
    )
    .orderBy(asc(schema.message.createdAt))
    .limit(5000);

  const rows = messages.map((m) => ({
    ...m,
    waTimestamp: m.waTimestamp?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  }));

  if (parseFormat(url) === "csv") {
    const csv = toCsv(rows as unknown as Record<string, unknown>[], [
      { key: "id", label: "id" },
      { key: "conversationId", label: "conversacion" },
      { key: "direction", label: "direccion" },
      { key: "type", label: "tipo" },
      { key: "text", label: "texto" },
      { key: "status", label: "estado" },
      { key: "aiGenerated", label: "generado_ia" },
      { key: "origin", label: "origen" },
      { key: "createdAt", label: "creado_en" },
    ]);
    return csvResponse(`mensajes-${org.name}.csv`, csv);
  }
  return Response.json({ org: org.name, count: rows.length, messages: rows });
});
