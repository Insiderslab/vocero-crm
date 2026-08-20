import { and, asc, eq } from "drizzle-orm";
import { csvResponse, toCsv } from "@/lib/csv";
import { getDb, schema } from "@/lib/db";
import { parseFormat } from "@/server/export/auth";
import { withExport } from "@/server/export/handler";

export const dynamic = "force-dynamic";

/** Extracción de conversaciones reales (sin las de prueba del Laboratorio). */
export const GET = withExport(async (org, url) => {
  const db = getDb();
  const conversations = await db
    .select({
      id: schema.conversation.id,
      contactId: schema.conversation.contactId,
      contactName: schema.contact.name,
      contactPhone: schema.contact.phone,
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
      handoffReason: schema.conversation.handoffReason,
      lastInboundAt: schema.conversation.lastInboundAt,
      lastMessageAt: schema.conversation.lastMessageAt,
      unreadCount: schema.conversation.unreadCount,
      createdAt: schema.conversation.createdAt,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      and(
        eq(schema.conversation.organizationId, org.id),
        eq(schema.conversation.isTest, false)
      )
    )
    .orderBy(asc(schema.conversation.createdAt));

  const rows = conversations.map((c) => ({
    ...c,
    handoffAt: c.handoffAt?.toISOString() ?? null,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  }));

  if (parseFormat(url) === "csv") {
    const csv = toCsv(rows as unknown as Record<string, unknown>[], [
      { key: "id", label: "id" },
      { key: "contactName", label: "contacto" },
      { key: "contactPhone", label: "telefono" },
      { key: "aiEnabled", label: "ia_activa" },
      { key: "handoffReason", label: "motivo_handoff" },
      { key: "lastInboundAt", label: "ultimo_entrante" },
      { key: "lastMessageAt", label: "ultimo_mensaje" },
      { key: "unreadCount", label: "no_leidos" },
      { key: "createdAt", label: "creada_en" },
    ]);
    return csvResponse(`conversaciones-${org.name}.csv`, csv);
  }
  return Response.json({
    org: org.name,
    count: rows.length,
    conversations: rows,
  });
});
