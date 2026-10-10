import { normalizeMx } from "@/lib/meta/client";
import { digitsOnly } from "@/lib/search";
import { BSUID_PREFIX } from "@/server/inbox/identity";

/**
 * 007 — Acceso reservado del agente (asistente interno del equipo).
 *
 * Una sola fuente de la normalización: la usan el guardado de la lista (API
 * del perfil) y la decisión del turno del agente. La clave comparable es la
 * misma que `contact.wa_identity` de un contacto con teléfono: solo dígitos,
 * con el 521→52 de México (`normalizeMx`).
 */

/** Máximo de números en la lista (un equipo, no una agenda). */
export const ALLOWLIST_MAX = 500;

/**
 * Lo que se acepta al escribir un número: «+» OBLIGATORIO al principio (formato
 * internacional) y luego dígitos, espacios, - . ( ). Sin «+», "347 123 4567"
 * pasaría la validación y no coincidiría nunca con un `wa_identity` (que
 * siempre lleva el código de país): se rechaza en vez de fallar en silencio.
 */
const TYPED_PHONE = /^\+[\d\s\-.()]+$/;

/**
 * Normaliza UNA línea tecleada por el owner. Devuelve null si no es un
 * teléfono internacional válido: «+», 7–15 dígitos, sin 0 inicial (ningún
 * código de país empieza por 0).
 */
export function normalizeAllowlistEntry(raw: string): string | null {
  const typed = raw.trim();
  if (!typed || !TYPED_PHONE.test(typed)) return null;
  const digits = digitsOnly(typed);
  if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
  return normalizeMx(digits);
}

export type ParsedAllowlist =
  | { ok: true; identities: string[] }
  | { ok: false; invalid: string[]; tooMany?: boolean };

/**
 * Texto (una línea por número) o lista → identidades normalizadas, sin
 * líneas vacías ni duplicados (también los que coinciden tras normalizar),
 * en el orden en que se escribieron. Cualquier línea inválida invalida todo.
 */
export function parseAllowlist(input: string | readonly string[]): ParsedAllowlist {
  const lines = (typeof input === "string" ? input.split(/\r?\n/) : [...input])
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const invalid = lines.filter((l) => normalizeAllowlistEntry(l) === null);
  if (invalid.length > 0) return { ok: false, invalid };
  const identities = [...new Set(lines.map((l) => normalizeAllowlistEntry(l)!))];
  if (identities.length > ALLOWLIST_MAX) return { ok: false, invalid: [], tooMany: true };
  return { ok: true, identities };
}

/**
 * Clave comparable de la identidad de un contacto. Las identidades BSUID
 * (`bsuid:<id>`) no tienen teléfono: devuelven null y JAMÁS coinciden (no se
 * les quitan las letras para "parecer" un número de la lista).
 */
export function comparableIdentity(waIdentity: string): string | null {
  if (waIdentity.startsWith(BSUID_PREFIX)) return null;
  if (!/^\d+$/.test(waIdentity)) return null;
  return normalizeMx(waIdentity);
}

/**
 * Clave comparable del ATRIBUTO `contact.phone` (003): un contacto que nació
 * de un mensaje solo-BSUID conserva `wa_identity = bsuid:…` de por vida
 * aunque luego llegue su teléfono; el teléfono se guarda aparte.
 */
export function comparablePhone(phone: string | null | undefined): string | null {
  const digits = digitsOnly(phone ?? "");
  return digits ? normalizeMx(digits) : null;
}

export type AllowlistPolicy = {
  restrictToAllowlist: boolean;
  allowedIdentities: readonly string[];
};

/**
 * ¿Puede el agente atender a este contacto? Con la restricción apagada,
 * siempre (comportamiento de siempre). Encendida: solo si su identidad
 * normalizada o su teléfono normalizado está en la lista. Fail-closed: lista
 * vacía = nadie; un BSUID sin teléfono = nadie.
 */
export function isAllowedIdentity(
  policy: AllowlistPolicy,
  waIdentity: string,
  phone?: string | null
): boolean {
  if (!policy.restrictToAllowlist) return true;
  const keys = [comparableIdentity(waIdentity), comparablePhone(phone)].filter(
    (k): k is string => k !== null
  );
  if (keys.length === 0) return false;
  return policy.allowedIdentities.some((entry) => {
    const allowed = comparableIdentity(entry);
    return allowed !== null && keys.includes(allowed);
  });
}
