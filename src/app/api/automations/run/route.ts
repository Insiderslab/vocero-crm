import { withAdminAuth } from "@/lib/api";
import { runAutomationsForOrg } from "@/server/automations/engine";

export const dynamic = "force-dynamic";

/**
 * "Ejecutar ahora": corre el motor solo para la org activa y devuelve las
 * estadísticas del tick. Sirve para probar una regla recién creada sin
 * esperar al scheduler.
 */
export const POST = withAdminAuth(async (session) => {
  const stats = await runAutomationsForOrg(session.organizationId);
  return Response.json({ stats });
});
