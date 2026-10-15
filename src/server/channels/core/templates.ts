import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * 005-livello-canali (M1.3, T028) — Estado de las plantillas aprobadas por el
 * proveedor (capacidad `templates: "required_outside_window"`). El evento
 * llega a nivel de cuenta padre (WhatsApp: WABA) y el núcleo ya resolvió la
 * organización. Idempotente: re-aplicar el mismo estado no tiene efectos.
 */

type TemplateStatus = (typeof schema.template.$inferSelect)["status"];

/** Estado del proveedor → estado de la plantilla (null = evento que no cambia nada). */
export function mapTemplateEvent(status: string | undefined): TemplateStatus | null {
  const s = (status ?? "").toUpperCase();
  if (s === "APPROVED") return "approved";
  if (s === "REJECTED") return "rejected";
  if (s === "PENDING" || s === "IN_APPEAL" || s === "PENDING_DELETION") {
    return "pending";
  }
  return null;
}

export async function applyTemplateStatus(
  organizationId: string,
  event: { event: string | undefined; name?: string; language?: string; reason?: string | null }
): Promise<void> {
  const status = mapTemplateEvent(event.event);
  const { name, language } = event;
  if (!status || !name || !language) return;

  await getDb()
    .update(schema.template)
    .set({
      status,
      rejectionReason: status === "rejected" ? (event.reason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.template.organizationId, organizationId),
        eq(schema.template.name, name),
        eq(schema.template.language, language)
      )
    );
}
