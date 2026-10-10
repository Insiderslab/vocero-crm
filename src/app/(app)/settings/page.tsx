import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { canManageWhatsapp } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * Entrada de Configuración: owner/admin aterrizan en la conexión de WhatsApp;
 * el resto (y sin sesión) en el equipo, la primera pantalla que sí pueden ver.
 */
export default async function SettingsPage() {
  const session = await getSessionOrNull();
  redirect(session && canManageWhatsapp(session.role) ? "/settings/whatsapp" : "/settings/team");
}
