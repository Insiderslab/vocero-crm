/**
 * Resolución de llaves i18n: ruta por puntos ("inbox.empty.title") sobre el
 * diccionario, con interpolación {{variable}}. Llave faltante → la propia
 * llave (visible en desarrollo, inofensiva en producción) en vez de tronar.
 */

type Dict = Record<string, unknown>;

export function translate(
  messages: Dict,
  key: string,
  vars?: Record<string, string | number>
): string {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") {
      node = undefined;
      break;
    }
    node = (node as Dict)[part];
  }
  if (typeof node !== "string") return key;
  if (!vars) return node;
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    vars[name] === undefined ? `{{${name}}}` : String(vars[name])
  );
}
