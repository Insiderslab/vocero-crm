import { describe, expect, it } from "vitest";
import { contentDisposition, csvResponse, toCsv } from "@/lib/csv";

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

describe("fórmulas: también TAB y CR al inicio", () => {
  const cols = [{ key: "v", label: "v" }];
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\t=1+1", "\r=1+1"])("%j queda como texto", (v) => {
    expect(toCsv([{ v }], cols)).toBe(`"v"\n"'${v}"\n`);
  });
  it("texto normal intacto (incluido un TAB en medio)", () => {
    expect(toCsv([{ v: "a\tb" }], cols)).toBe('"v"\n"a\tb"\n');
  });
});

describe("Content-Disposition con el nombre de la organización", () => {
  it("nombre simple: igual que antes más filename*", () => {
    expect(contentDisposition("leads-Acme.csv")).toBe(
      `attachment; filename="leads-Acme.csv"; filename*=UTF-8''leads-Acme.csv`
    );
  });

  it("comillas, barras, punto y coma y saltos de línea no rompen la cabecera", () => {
    const v = contentDisposition('mensajes-Evil"; filename="x.exe\r\nSet-Cookie: a=b/..\\.csv');
    expect(v).not.toMatch(/[\r\n]/);
    const ascii = /filename="([^"]*)"/.exec(v)?.[1];
    expect(ascii).toBeDefined();
    expect(ascii).not.toMatch(/["\\/;]/);
    // un solo filename= ASCII y un solo filename*
    expect(v.match(/filename="/g)).toHaveLength(1);
    expect(v.match(/filename\*=/g)).toHaveLength(1);
  });

  it("no ASCII: respaldo ASCII legible y nombre real en filename* (RFC 5987)", () => {
    const v = contentDisposition("contactos-Peluquería Ñandú 日本.csv");
    expect(v).toContain('filename="contactos-Peluqueria Nandu __.csv"');
    expect(v).toContain(
      "filename*=UTF-8''" + encodeURIComponent("contactos-Peluquería Ñandú 日本.csv")
    );
    const star = /filename\*=UTF-8''(.*)$/.exec(v)?.[1] ?? "";
    expect(decodeURIComponent(star)).toBe("contactos-Peluquería Ñandú 日本.csv");
    expect(star).not.toMatch(/['()* ]/);
  });

  it("csvResponse ya no lanza con un nombre con salto de línea (antes: cabecera inválida)", () => {
    const res = csvResponse("mensajes-Uno\nDos.csv", "x\n");
    expect(res.headers.get("content-disposition")).toContain('filename="mensajes-UnoDos.csv"');
  });
});
