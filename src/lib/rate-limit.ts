/**
 * Limitación de tasa in-process por clave (IP) con ventana deslizante
 * (FR-062). Suficiente para el monolito de una instancia; sin Redis
 * (Constitución II).
 */

type Bucket = number[]; // timestamps (ms) de los intentos

const globalForRl = globalThis as unknown as {
  __voceroRateLimit?: Map<string, Bucket>;
  __voceroRateLimitOps?: number;
  __voceroRateLimitMaxWindow?: number;
};

/** Cada cuántos accesos se barren las entradas caducadas (amortizado). */
export const SWEEP_EVERY = 500;

function store(): Map<string, Bucket> {
  if (!globalForRl.__voceroRateLimit) {
    globalForRl.__voceroRateLimit = new Map();
  }
  return globalForRl.__voceroRateLimit;
}

/**
 * Barrido amortizado: cada SWEEP_EVERY accesos elimina las entradas cuya
 * marca más reciente ya salió de la mayor ventana vista (caducadas para
 * cualquier límite), para que el mapa no crezca sin fin.
 */
function maybeSweep(windowMs: number, now: number): void {
  globalForRl.__voceroRateLimitMaxWindow = Math.max(
    globalForRl.__voceroRateLimitMaxWindow ?? 0,
    windowMs
  );
  const ops = (globalForRl.__voceroRateLimitOps ?? 0) + 1;
  if (ops < SWEEP_EVERY) {
    globalForRl.__voceroRateLimitOps = ops;
    return;
  }
  globalForRl.__voceroRateLimitOps = 0;
  const cutoff = now - globalForRl.__voceroRateLimitMaxWindow;
  const buckets = store();
  for (const [k, b] of buckets) {
    if ((b[b.length - 1] ?? 0) <= cutoff) buckets.delete(k);
  }
}

/** Número de claves en memoria (tests). */
export function rateLimitSize(): number {
  return store().size;
}

export type RateLimitResult = { allowed: boolean; remaining: number };

export function checkRateLimit(
  key: string,
  opts: { windowMs: number; max: number },
  now: number = Date.now()
): RateLimitResult {
  const buckets = store();
  maybeSweep(opts.windowMs, now);
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
  globalForRl.__voceroRateLimitOps = 0;
  globalForRl.__voceroRateLimitMaxWindow = 0;
}

/** 10 intentos / 10 minutos por IP en login y registro (FR-062). */
export const AUTH_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };

const RATE_LIMITED_PATHS = new Set(["/sign-in/email", "/sign-up/email"]);

/** Login/registro: consume el contador `<ruta>:<IP del cliente>`. false = 429. */
export function authRateLimitAllowed(
  path: string,
  headers: Headers | null | undefined
): boolean {
  if (!RATE_LIMITED_PATHS.has(path)) return true;
  return checkRateLimit(`${path}:${clientIp(headers)}`, AUTH_RATE_LIMIT).allowed;
}
