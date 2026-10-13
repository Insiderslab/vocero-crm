import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { messagesFor } from "@/lib/i18n/messages";

/**
 * Modo agencia (override de callback) con la firma obligatoria: la
 * documentación NO debe pedir que se copie el App Secret de la agencia en las
 * instancias de los clientes (da control a nivel de app). Debe decir que no
 * está soportado hasta que exista un reenvío firmado.
 */

const readme = readFileSync("README.md", "utf8");
const envExample = readFileSync(".env.example", "utf8");

describe("modo agencia: nunca el App Secret de la agencia en el cliente", () => {
  it("README: aviso de no soportado y explicación del riesgo", () => {
    expect(readme).toContain("Hoy NO está soportado");
    expect(readme).toContain("No copies el App Secret de la agencia");
    expect(readme).toMatch(/reenvío firmado/);
    expect(readme).not.toMatch(/necesita `META_APP_SECRET` = App Secret de esa app/);
  });

  it(".env.example: no soportado y nunca copiarlo", () => {
    expect(envExample).toMatch(/Modo agencia \(override de callback\): NO SOPORTADO/);
    expect(envExample).toContain("NUNCA lo copies en la instancia de un cliente");
    expect(envExample).not.toMatch(/Modo agencia[^\n]*: el App Secret de la app de la agencia/);
  });

  it.each(["es", "en", "it"] as const)("UI (%s): el aviso de secreto ausente no manda a usar el de la agencia", (locale) => {
    const w = (messagesFor(locale) as unknown as { settings: { whatsapp: Record<string, string> } })
      .settings.whatsapp;
    expect(w.signatureMissing).not.toMatch(/agency app's\)|app de la agencia;|app dell'agenzia;/);
    expect(w.originAgency2).toMatch(/NOT supported|NO está soportado|NON è supportata/);
  });
});
