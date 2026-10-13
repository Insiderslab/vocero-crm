import { asc, eq } from "drizzle-orm";
import { csvResponse, toCsv } from "@/lib/csv";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { parseFormat } from "@/server/export/auth";
import { withExport } from "@/server/export/handler";

export const dynamic = "force-dynamic";

/** Extracción de leads con etapa, prioridad, monto y tags del contacto. */
export const GET = withExport(async (org, url) => {
  const db = getDb();
  const leads = await db
    .select({
      id: schema.lead.id,
      contactId: schema.lead.contactId,
      contactName: schema.contact.name,
      contactPhone: schema.contact.phone,
      stage: schema.pipelineStage.name,
      stageKind: schema.pipelineStage.kind,
      priority: schema.lead.priority,
      amountCents: schema.lead.amountCents,
      currency: schema.lead.currency,
      lastActivityAt: schema.lead.lastActivityAt,
      createdAt: schema.lead.createdAt,
      updatedAt: schema.lead.updatedAt,
    })
    .from(schema.lead)
    .innerJoin(
      schema.contact,
      scoped(schema.contact.organizationId, org.id, eq(schema.lead.contactId, schema.contact.id))
    )
    .innerJoin(
      schema.pipelineStage,
      scoped(
        schema.pipelineStage.organizationId,
        org.id,
        eq(schema.lead.stageId, schema.pipelineStage.id)
      )
    )
    .where(scoped(schema.lead.organizationId, org.id))
    .orderBy(asc(schema.lead.createdAt));

  const tagRows = await db
    .select({
      contactId: schema.contactTag.contactId,
      name: schema.tag.name,
    })
    .from(schema.contactTag)
    .innerJoin(
      schema.tag,
      scoped(schema.tag.organizationId, org.id, eq(schema.contactTag.tagId, schema.tag.id))
    )
    .where(scoped(schema.contactTag.organizationId, org.id));
  const tagsByContact = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsByContact.get(t.contactId) ?? [];
    list.push(t.name);
    tagsByContact.set(t.contactId, list);
  }

  const rows = leads.map((l) => ({
    ...l,
    amount: l.amountCents === null ? null : l.amountCents / 100,
    tags: tagsByContact.get(l.contactId) ?? [],
    lastActivityAt: l.lastActivityAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  }));

  if (parseFormat(url) === "csv") {
    const csv = toCsv(
      rows.map((r) => ({ ...r, tags: r.tags.join("; ") })),
      [
        { key: "id", label: "id" },
        { key: "contactName", label: "contacto" },
        { key: "contactPhone", label: "telefono" },
        { key: "stage", label: "etapa" },
        { key: "stageKind", label: "tipo_etapa" },
        { key: "priority", label: "prioridad" },
        { key: "amount", label: "monto" },
        { key: "currency", label: "moneda" },
        { key: "tags", label: "tags" },
        { key: "lastActivityAt", label: "ultima_actividad" },
        { key: "createdAt", label: "creado_en" },
      ]
    );
    return csvResponse(`leads-${org.name}.csv`, csv);
  }
  return Response.json({ org: org.name, count: rows.length, leads: rows });
});
