import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth, withAdminAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { countVariables } from "@/lib/templates";

export const dynamic = "force-dynamic";

/** Reglas de la org con nombre de tag y plantilla (custom heili.cloud). */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const rules = await db
    .select({
      rule: schema.automationRule,
      tagName: schema.tag.name,
      templateName: schema.template.name,
      templateStatus: schema.template.status,
      templateBody: schema.template.body,
    })
    .from(schema.automationRule)
    .innerJoin(schema.tag, eq(schema.automationRule.tagId, schema.tag.id))
    .innerJoin(
      schema.template,
      eq(schema.automationRule.templateId, schema.template.id)
    )
    .where(scoped(schema.automationRule.organizationId, session.organizationId))
    .orderBy(desc(schema.automationRule.createdAt));

  return Response.json({
    rules: rules.map((r) => ({
      id: r.rule.id,
      name: r.rule.name,
      tagId: r.rule.tagId,
      tagName: r.tagName,
      templateId: r.rule.templateId,
      templateName: r.templateName,
      templateStatus: r.templateStatus,
      templateBody: r.templateBody,
      intervalDays: r.rule.intervalDays,
      enabled: r.rule.enabled,
      createdAt: r.rule.createdAt.toISOString(),
    })),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  tagId: z.string().min(1),
  templateId: z.string().min(1),
  intervalDays: z.number().int().min(1).max(3650),
});

/**
 * Crea una regla. Validaciones duras: el tag y la plantilla son de la org, la
 * plantilla está APROBADA (Meta no deja otra cosa fuera de la ventana) y tiene
 * a lo más UNA variable (v1: {{1}} = nombre del contacto).
 */
export const POST = withAdminAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const db = getDb();

  const tags = await db
    .select({ id: schema.tag.id })
    .from(schema.tag)
    .where(
      scoped(
        schema.tag.organizationId,
        session.organizationId,
        eq(schema.tag.id, body.data.tagId)
      )
    )
    .limit(1);
  if (!tags[0]) return apiError(422, "invalid_tag", "La etiqueta no existe");

  const templates = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        session.organizationId,
        eq(schema.template.id, body.data.templateId)
      )
    )
    .limit(1);
  const template = templates[0];
  if (!template) {
    return apiError(422, "invalid_template", "La plantilla no existe");
  }
  if (template.status !== "approved") {
    return apiError(
      422,
      "template_not_approved",
      "Solo se pueden automatizar plantillas aprobadas por Meta"
    );
  }
  if (countVariables(template.body) > 1) {
    return apiError(
      422,
      "template_multi_variable",
      "Por ahora las automatizaciones solo usan plantillas sin variables o con {{1}} (el nombre del contacto)"
    );
  }

  const inserted = await db
    .insert(schema.automationRule)
    .values({
      id: newId("automationRule"),
      organizationId: session.organizationId,
      name: body.data.name,
      tagId: body.data.tagId,
      templateId: body.data.templateId,
      intervalDays: body.data.intervalDays,
    })
    .returning();
  return Response.json({ rule: inserted[0] }, { status: 201 });
});
