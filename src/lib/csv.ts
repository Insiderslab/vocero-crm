/**
 * Serializador CSV mínimo para la API de extracción (custom heili.cloud).
 * Reglas: RFC 4180 — comillas dobladas, separador coma, CRLF opcional (aquí
 * LF, que Excel y pandas aceptan igual), y fila de encabezados.
 * Punto extra: fuerza texto en celdas que empiezan por = + - @ TAB o CR para
 * que Excel/LibreOffice no las ejecuten como fórmula (inyección CSV clásica;
 * TAB y CR también disparan la evaluación en algunas hojas, guía OWASP).
 */

export type CsvColumn = { key: string; label: string };

function escapeCell(value: unknown): string {
  let s =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(
  rows: Record<string, unknown>[],
  columns: CsvColumn[]
): string {
  const header = columns.map((c) => escapeCell(c.label)).join(",");
  const body = rows.map((r) =>
    columns.map((c) => escapeCell(r[c.key])).join(",")
  );
  return [header, ...body].join("\n") + "\n";
}

/**
 * `Content-Disposition` seguro para un nombre que lleva datos del usuario (el
 * nombre de la organización): sin caracteres de control (un CR/LF partiría la
 * cabecera), sin comillas ni barras en el `filename` ASCII de respaldo, y el
 * nombre real en `filename*` (RFC 5987/6266, UTF-8 percent-encoded).
 */
export function contentDisposition(filename: string): string {
  const clean = filename.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "export.csv";
  const ascii =
    clean
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/["\\/;]/g, "")
      .replace(/[^\x20-\x7e]/g, "_")
      .trim() || "export.csv";
  const utf8 = encodeURIComponent(clean).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** Respuesta CSV lista para descargar. */
export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": contentDisposition(filename),
    },
  });
}
