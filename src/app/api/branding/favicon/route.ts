import { readMediaFile } from "@/server/whatsapp/media";
import { getRequestBrandingContext } from "@/server/branding-request";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { FAVICON_ASSET, generatedFaviconSvg } from "@/lib/favicon";

export const dynamic = "force-dynamic";

/**
 * Cabeceras con las que se sirve CUALQUIER icono, subido o generado.
 *
 * Un SVG que sube el dueño es un documento con permiso de ejecutar guiones si
 * alguien navega a su URL. La CSP lo deja sin nada que ejecutar y `nosniff`
 * impide que el navegador reinterprete el tipo. Cuesta dos cabeceras y quita
 * de la mesa toda esa clase de problema.
 */
function cabeceras(mime: string, cacheable: boolean): HeadersInit {
  return {
    "content-type": mime,
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    "x-content-type-options": "nosniff",
    // La URL lleva `?v=` y cambia con la marca, así que se puede cachear
    // fuerte. Sin ese sufijo —alguien pidiendo la ruta pelada— no.
    // `private`: el icono depende de la sesión (CRM-1, cada organización el
    // suyo); una caché compartida no debe servir el de una a otra.
    "cache-control": cacheable
      ? "private, max-age=31536000, immutable"
      : "private, max-age=60",
    vary: "Cookie",
  };
}

/**
 * El icono de la pestaña. **Ruta pública**: el login también tiene pestaña, y
 * ahí todavía no hay sesión. Con sesión, el de su organización; sin sesión, el
 * de la instancia (CRM-1: nunca el de una organización cualquiera).
 */
export async function GET(req: Request) {
  const cacheable = new URL(req.url).searchParams.has("v");

  const ctx = await getRequestBrandingContext().catch(() => null);
  const branding = ctx?.branding ?? DEFAULT_BRANDING;

  if (ctx?.organizationId && branding.favicon) {
    try {
      const buf = await readMediaFile(ctx.organizationId, FAVICON_ASSET);
      return new Response(new Uint8Array(buf), {
        headers: cabeceras(branding.favicon.mime, cacheable),
      });
    } catch {
      // El archivo se perdió (volumen sin montar, restauración a medias). Se
      // cae al generado en vez de dejar la pestaña sin icono: un 404 aquí se
      // ve como si la instancia estuviera rota.
    }
  }

  return new Response(generatedFaviconSvg(branding), {
    headers: cabeceras("image/svg+xml", cacheable),
  });
}
