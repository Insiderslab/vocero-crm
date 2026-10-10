import type { ReactNode } from "react";
import { getSessionOrNull } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { isOrgAdmin } from "@/lib/roles";

/**
 * Pantallas de configuración de la organización (agente, Laboratorio,
 * automatizaciones, plantillas): solo owner/admin. Un member, o sin sesión,
 * ve únicamente el aviso. La API ya lo exige por su cuenta (`withAdminAuth`);
 * esto evita pintar una pantalla cuyas acciones fallarían. Una sola fuente
 * para las cuatro páginas.
 */
export async function adminOnly(content: ReactNode): Promise<ReactNode> {
  const session = await getSessionOrNull();
  if (session && isOrgAdmin(session.role)) return content;
  const { t } = await getT();
  return <p className="max-w-2xl text-sm text-muted-foreground">{t("common.adminOnly")}</p>;
}
