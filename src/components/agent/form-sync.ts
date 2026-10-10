/**
 * Estado de un formulario editable que se alimenta del servidor (pantalla
 * Agente IA). Reglas puras, sin React, para poder probarlas:
 *
 * - Lo que llega del servidor (cualquier `refetch`, p. ej. tras tocar el KB o
 *   el interruptor) SOLO reemplaza el formulario si el usuario no tiene
 *   cambios sin guardar. Antes lo pisaba siempre y se perdían ediciones.
 * - Un guardado que falla NO toca el formulario: los valores del usuario se
 *   quedan y el error se muestra. Solo un guardado correcto lo limpia.
 */

export type ServerFormState<T> = { form: T; dirty: boolean };

export type ServerFormAction<T> =
  /** Llegó un valor del servidor (carga inicial o refetch). */
  | { type: "server"; value: T }
  /** El usuario editó campos. */
  | { type: "edit"; patch: Partial<T> }
  /** El servidor confirmó el guardado de ESTE formulario con `value`. */
  | { type: "saved"; value: T };

export function initServerForm<T>(value: T): ServerFormState<T> {
  return { form: value, dirty: false };
}

export function serverFormReducer<T>(
  state: ServerFormState<T>,
  action: ServerFormAction<T>
): ServerFormState<T> {
  switch (action.type) {
    case "server":
      return state.dirty ? state : { form: action.value, dirty: false };
    case "edit":
      return { form: { ...state.form, ...action.patch }, dirty: true };
    case "saved":
      return { form: action.value, dirty: false };
  }
}

export type SaveResult<J = unknown> =
  | { ok: true; json: J | null }
  | { ok: false; message: string | null; invalid: string[] };

/**
 * Lee la respuesta de un guardado. Sin respuesta (red caída) o con un estado
 * HTTP de error (401/403/422/5xx) → `ok: false` con el mensaje del servidor
 * si lo trae (`{ error: { message, invalid? } }`).
 */
export async function readSaveResult<J = unknown>(res: Response | null): Promise<SaveResult<J>> {
  const json = (await res?.json().catch(() => null)) as
    | (J & { error?: { message?: unknown; invalid?: unknown } })
    | null;
  if (!res?.ok) {
    const error = json?.error;
    return {
      ok: false,
      message: typeof error?.message === "string" ? error.message : null,
      invalid: Array.isArray(error?.invalid) ? error.invalid.map(String) : [],
    };
  }
  return { ok: true, json: json ?? null };
}

/**
 * Secuencia de peticiones de lectura: solo la ÚLTIMA iniciada puede aplicar
 * su respuesta. Dos refetch en vuelo (guardar el perfil y luego el KB, por
 * ejemplo) pueden volver en desorden; sin esto, la respuesta vieja que llega
 * tarde pisaría a la nueva.
 */
export function createLatestGate(): { begin: () => number; isLatest: (ticket: number) => boolean } {
  let last = 0;
  return {
    begin: () => ++last,
    isLatest: (ticket) => ticket === last,
  };
}
