/**
 * Limitación de tasa in-process por clave (IP) con ventana deslizante
 * (FR-062). Suficiente para el monolito de una instancia; sin Redis
 * (Constitución II).
 */

type Bucket = number[]; // timestamps (ms) de los intentos

const globalForRl = globalThis as unknown as {
  __voceroRateLimit?: Map<string, Bucket>;
};

function store(): Map<string, Bucket> {
  if (!globalForRl.__voceroRateLimit) {
    globalForRl.__voceroRateLimit = new Map();
  }
  return globalForRl.__voceroRateLimit;
}

export type RateLimitResult = { allowed: boolean; remaining: number };

export function checkRateLimit(
  key: string,
  opts: { windowMs: number; max: number },
  now: number = Date.now()
): RateLimitResult {
  const buckets = store();
  const cutoff = now - opts.windowMs;
  const bucket = (buckets.get(key) ?? []).filter((t) => t > cutoff);

  if (bucket.length >= opts.max) {
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0 };
  }
  bucket.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: opts.max - bucket.length };
}

/** Consulta sin consumir: ¿la clave ya agotó su ventana? */
export function isRateLimited(
  key: string,
  opts: { windowMs: number; max: number },
  now: number = Date.now()
): boolean {
  const cutoff = now - opts.windowMs;
  return (store().get(key) ?? []).filter((t) => t > cutoff).length >= opts.max;
}

/**
 * IP del cliente para los contadores por IP: primera entrada de
 * `x-forwarded-for`, si no `x-real-ip`, si no "local". Solo es fiable si el
 * proxy de delante (Caddy, Traefik) fija esas cabeceras.
 */
export function clientIp(headers: Headers | null | undefined): string {
  return (
    headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers?.get("x-real-ip") ||
    "local"
  );
}

/** Solo para tests. */
export function resetRateLimit(): void {
  store().clear();
}

/** 10 intentos / 10 minutos por IP en login y registro (FR-062). */
export const AUTH_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };
