/**
 * 009 (E1) — Qué hacer cuando el proveedor de IA falla. Decisiones PURAS (sin
 * BD ni red) para poder probarlas una por una; el pipeline las aplica.
 *
 * Antes: cualquier fallo → handoff `error` en silencio. El cliente se quedaba
 * sin respuesta y nadie del equipo se enteraba.
 */

/** Cómo se lanzó el turno. */
export type TurnMode =
  /** Entrante real (coalesce) o Laboratorio. */
  | "normal"
  /** El segundo intento programado tras un `provider_error`. */
  | "retry"
  /** «Riprova risposta IA» desde la bandeja: ES el segundo intento. */
  | "manual";

export type ProviderFailure = "provider_error" | "invalid_output";

/**
 * Tras un fallo de `chatJson`: ¿reintentar más tarde o pasar a un humano?
 *
 * Solo se reintenta UNA vez, solo un `provider_error` (red, 5xx, 402, tiempo
 * agotado: el proveedor puede volver), solo en conversaciones reales y solo
 * desde un turno normal. Un turno `retry` o `manual` nunca programa otro: así
 * no hay bucle. `invalid_output` ya pasó por los 3 intentos de `chatJson`
 * con el recordatorio STRICT; repetir el mismo prompt no lo arregla.
 */
export function decideOnFailure(input: {
  error: ProviderFailure;
  mode: TurnMode;
  isTest: boolean;
  retryDelayMs: number;
  /**
   * El turno empezó con un segundo intento YA pendiente (lo reclamó al llegar
   * un entrante nuevo): volver a armar otro aplazaría la escalada con cada
   * mensaje del cliente, para siempre.
   */
  retryAlreadyPending?: boolean;
}): "retry_later" | "handoff" {
  if (input.error !== "provider_error") return "handoff";
  if (input.retryAlreadyPending) return "handoff";
  if (input.mode !== "normal") return "handoff";
  if (input.isTest) return "handoff";
  if (input.retryDelayMs <= 0) return "handoff";
  return "retry_later";
}

/**
 * ¿Sigue teniendo sentido el segundo intento? Solo si el mensaje más reciente
 * de la conversación sigue siendo EL entrante al que el turno fallido debía
 * responder. Cualquier mensaje posterior lo invalida (sin `expectInboundId`,
 * caso del arranque tras un reinicio, basta con que el último sea entrante):
 * - un entrante nuevo ya agendó su propio turno (que responde a todo);
 * - un saliente significa que alguien (el operador, otro cerebro) ya contestó.
 * Así el segundo intento nunca produce una respuesta doble.
 */
export function retryStillValid(
  expectInboundId: string | undefined,
  newest: { id: string; direction: string } | undefined
): boolean {
  if (!newest || newest.direction !== "in") return false;
  // Tras un reinicio el entrante concreto ya no se conoce (el temporizador
  // vivía en memoria): basta con que nadie haya contestado después del
  // último entrante — si es otro más nuevo, el turno responde a todo.
  if (!expectInboundId) return true;
  return newest.id === expectInboundId;
}

/**
 * ¿Se manda el mensaje de cortesía? Una vez por paso a humano: solo si este
 * turno HIZO la transición (la conversación no estaba ya con un humano), si
 * hay texto, si no es el Laboratorio y si después del último entrante no hay
 * ya un saliente con ese mismo texto.
 */
export function shouldSendErrorReply(input: {
  text: string | null | undefined;
  transitioned: boolean;
  isTest: boolean;
  alreadySent: boolean;
}): boolean {
  if (!input.text?.trim()) return false;
  if (!input.transitioned) return false;
  if (input.isTest) return false;
  return !input.alreadySent;
}

/**
 * Mensajes de un hilo, del más reciente al más antiguo: ¿hay un saliente con
 * `text` exacto ANTES de llegar al último entrante?
 */
export function sentSinceLastInbound(
  newestFirst: { direction: string; text: string | null }[],
  text: string
): boolean {
  for (const m of newestFirst) {
    if (m.direction === "in") return false;
    if (m.text === text) return true;
  }
  return false;
}
