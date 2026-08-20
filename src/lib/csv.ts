/**
 * Serializador CSV mínimo para la API de extracción (custom heili.cloud).
 * Reglas: RFC 4180 — comillas dobladas, separador coma, CRLF opcional (aquí
 * LF, que Excel y pandas aceptan igual), y fila de encabezados.
 * Punto extra: fuerza texto en celdas que empiezan por = + - @ para que
 * Excel no las ejecute como fórmula (inyección CSV clásica).
 */

export type CsvColumn = { key: string; label: string };

function escapeCell(value: unknown): string {
  let s =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
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

/** Respuesta CSV lista para descargar. */
export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
