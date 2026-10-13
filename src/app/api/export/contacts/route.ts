import { asc, eq } from "drizzle-orm";
import { csvResponse, toCsv } from "@/lib/csv";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { parseFormat } from "@/server/export/auth";
import { withExport } from "@/server/export/handler";

export const dynamic = "force-dynamic";

/**
 * Extracción de contactos de la org (custom heili.cloud): JSON para IA,
 * `?format=csv` para hojas de cálculo. Incluye etapa, prioridad y tags.
 */
export const GET = withExport(async (org, url) => {
  const db = getDb();

  const contacts = await db
    .select()
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, org.id))
    .orderBy(asc(schema.contact.createdAt));

  // Etapa/prioridad del lead (1:1 con contacto) y tags, en consultas aparte
  // para no duplicar filas con joins múltiples.
  const leads = await db
    .select({
      contactId: schema.lead.contactId,
      stageName: schema.pipelineStage.name,
      priority: schema.lead.priority,
    })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      scoped(
        schema.pipelineStage.organizationId,
        org.id,
        eq(schema.lead.stageId, schema.pipelineStage.id)
      )
    )
    .where(scoped(schema.lead.organizationId, org.id));
  const leadByContact = new Map(leads.map((l) => [l.contactId, l]));

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

  const rows = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    waIdentity: c.waIdentity,
    source: c.source,
    stage: leadByContact.get(c.id)?.stageName ?? null,
    priority: leadByContact.get(c.id)?.priority ?? null,
    tags: tagsByContact.get(c.id) ?? [],
    notes: c.notes,
    ficha: c.ficha ?? {},
    archivedAt: c.archivedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  if (parseFormat(url) === "csv") {
    const csv = toCsv(
      rows.map((r) => ({ ...r, tags: r.tags.join("; "), ficha: JSON.stringify(r.ficha) })),
      [
        { key: "id", label: "id" },
        { key: "name", label: "nombre" },
        { key: "phone", label: "telefono" },
        { key: "source", label: "fuente" },
        { key: "stage", label: "etapa" },
        { key: "priority", label: "prioridad" },
        { key: "tags", label: "tags" },
        { key: "notes", label: "notas" },
        { key: "ficha", label: "ficha_json" },
        { key: "archivedAt", label: "archivado_en" },
        { key: "createdAt", label: "creado_en" },
      ]
    );
    return csvResponse(`contactos-${org.name}.csv`, csv);
  }
  return Response.json({ org: org.name, count: rows.length, contacts: rows });
});
