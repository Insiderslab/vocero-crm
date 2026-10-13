/**
 * Contadores de la firma del webhook, por PROCESO (desde el arranque): última
 * firma verificada, última firma inválida y cuántas inválidas. Los muestra
 * Configuración → WhatsApp (solo owner/admin) para que «firma activa» no sea
 * solo «hay un secreto»: si el secreto no coincide con la app que firma, todo
 * llega como inválido y aquí se ve.
 *
 * En globalThis: Next puede evaluar un módulo más de una vez (una por ruta),
 * y el webhook y la ruta de configuración deben ver los mismos números. Con
 * varias réplicas cada una tiene los suyos.
 */

type State = {
  lastVerifiedAt: number | null;
  lastInvalidAt: number | null;
  invalidCount: number;
  lastInvalidLogAt: number | null;
};

const g = globalThis as unknown as { __webhookSignatureStats?: State };

function state(): State {
  return (g.__webhookSignatureStats ??= {
    lastVerifiedAt: null,
    lastInvalidAt: null,
    invalidCount: 0,
    lastInvalidLogAt: null,
  });
}

/** Como mucho una línea de log por minuto: Meta reintenta, y un atacante también. */
export const INVALID_SIGNATURE_LOG_EVERY_MS = 60_000;

export function recordVerifiedSignature(now: number = Date.now()): void {
  state().lastVerifiedAt = now;
}

/**
 * Firma inválida (→ 401). Cuenta siempre; registra como mucho una vez por
 * minuto, SIN el valor de la cabecera ni el secreto: solo si la cabecera venía
 * y el tamaño del cuerpo.
 */
export function recordInvalidSignature(
  info: { headerPresent: boolean; bytes: number },
  now: number = Date.now()
): void {
  const s = state();
  s.invalidCount += 1;
  s.lastInvalidAt = now;
  if (s.lastInvalidLogAt !== null && now - s.lastInvalidLogAt < INVALID_SIGNATURE_LOG_EVERY_MS) {
    return;
  }
  s.lastInvalidLogAt = now;
  console.warn(
    `[webhook] firma inválida (401): cabecera presente=${info.headerPresent ? "sí" : "no"}, ` +
      `${info.bytes} bytes (${s.invalidCount} desde el arranque) — si falla todo, ` +
      "META_APP_SECRET no coincide con la app que firma"
  );
}

export type WebhookSignatureStats = {
  lastVerifiedAt: string | null;
  lastInvalidAt: string | null;
  invalidSinceBoot: number;
};

export function webhookSignatureStats(): WebhookSignatureStats {
  const s = state();
  return {
    lastVerifiedAt: s.lastVerifiedAt === null ? null : new Date(s.lastVerifiedAt).toISOString(),
    lastInvalidAt: s.lastInvalidAt === null ? null : new Date(s.lastInvalidAt).toISOString(),
    invalidSinceBoot: s.invalidCount,
  };
}

/** Solo tests. */
export function resetWebhookSignatureStats(): void {
  g.__webhookSignatureStats = undefined;
}
