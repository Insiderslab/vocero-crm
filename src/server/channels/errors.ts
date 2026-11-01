/**
 * 005-livello-canali (M1.3) — Error tipado del envío, común a todos los
 * canales (ADR §3.1: `send` lanza SIEMPRE `SendError`). Los códigos son un
 * contrato HTTP (`/api/conversations/[id]/messages*`, `/api/bot/messages`):
 * no se renombran. Se movió aquí desde `src/server/inbox/send.ts`, que lo
 * re-exporta con la misma firma.
 */
export class SendError extends Error {
  code:
    | "sandbox_violation"
    | "not_connected"
    | "reconnect_required"
    | "window_closed"
    | "meta_error"
    | "meta_unavailable"
    | "wapi_key_missing"
    | "upload_failed"
    /** 016: modalità ascolto accesa, Orbit non invia da solo. */
    | "listening_mode";
  /** 008: presente cuando el fallo ocurrió TRAS persistir el mensaje (failed). */
  messageId?: string;

  constructor(code: SendError["code"], message: string) {
    super(message);
    this.name = "SendError";
    this.code = code;
  }
}
