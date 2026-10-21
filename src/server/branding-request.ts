import { getSessionOrNull } from "@/lib/auth/session";
import type { Branding } from "@/lib/branding";
import { getBrandingContext } from "@/server/branding";

/**
 * Marca de ESTA petición: la de la organización de la sesión si la hay; sin
 * sesión (login, favicon antes de entrar), la de la instancia (CRM-1).
 * La usan el layout raíz —acento, título y favicon de toda la app— y la ruta
 * pública del favicon, que el navegador pide con las cookies de la sesión.
 */
export async function getRequestBrandingContext(): Promise<{
  organizationId: string | null;
  branding: Branding;
}> {
  const session = await getSessionOrNull().catch(() => null);
  return getBrandingContext(session?.organizationId ?? null);
}

export async function getRequestBranding(): Promise<Branding> {
  return (await getRequestBrandingContext()).branding;
}
