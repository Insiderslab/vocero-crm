import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  const cols = [
    { key: "name", label: "nombre" },
    { key: "note", label: "nota" },
  ];

  it("encabezados + filas con comillas", () => {
    const csv = toCsv([{ name: "Ana", note: "hola" }], cols);
    expect(csv).toBe('"nombre","nota"\n"Ana","hola"\n');
  });

  it("escapa comillas doblándolas y respeta comas y saltos dentro", () => {
    const csv = toCsv([{ name: 'dijo "hola", y se fue', note: "a\nb" }], cols);
    expect(csv).toBe('"nombre","nota"\n"dijo ""hola"", y se fue","a\nb"\n');
  });

  it("null y undefined quedan vacíos; objetos viajan como JSON", () => {
    const csv = toCsv([{ name: null, note: { a: 1 } }], cols);
    expect(csv).toBe('"nombre","nota"\n"","{""a"":1}"\n');
  });

  it("neutraliza fórmulas de Excel (= + - @ al inicio)", () => {
    const csv = toCsv([{ name: "=CMD()", note: "+52155" }], cols);
    expect(csv).toContain("'=CMD()");
    expect(csv).toContain("'+52155");
  });
});
