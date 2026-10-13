/**
 * 009 (E5/E6) — Prefetch por INTENCIÓN para los enlaces de la barra lateral.
 *
 * Por defecto `<Link>` precarga cada enlace en cuanto entra en pantalla: al
 * abrir cualquier página, los 6–8 enlaces del lateral piden `?_rsc=` A LA VEZ,
 * y cada una es un render dinámico (sesión, marca, organizaciones). En
 * producción esas ráfagas son justo las peticiones que vuelven con 503 desde
 * el proxy, y Next guarda un prefetch fallido como "navegación de página
 * completa": el clic siguiente recarga TODA la página y el primer clic sobre
 * la página nueva cae antes de que hidrate (E6).
 *
 * Aquí se precarga solo cuando hay intención (puntero encima, foco, toque) y
 * una vez por enlace cada `ttlMs`: una petición cada vez, nunca una ráfaga.
 */
export function createIntentPrefetcher(
  prefetch: (href: string) => void,
  ttlMs = 30_000,
  now: () => number = Date.now
): (href: string) => void {
  const last = new Map<string, number>();
  return (href) => {
    const at = now();
    const prev = last.get(href);
    if (prev !== undefined && at - prev < ttlMs) return;
    last.set(href, at);
    try {
      prefetch(href);
    } catch {
      // Un prefetch es una optimización: si falla, el clic navega igual.
    }
  };
}
