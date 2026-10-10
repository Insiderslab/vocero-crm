import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkSignature,
  isValidSignature,
  isValidWebhookToken,
  safeEqual,
} from "@/server/inbox/webhook";

describe("capa 1: token en la ruta (FR-041/FR-083)", () => {
  it("segmento correcto → válido", () => {
    expect(isValidWebhookToken("token-abc", "token-abc")).toBe(true);
  });

  it("segmento incorrecto → inválido (la ruta responde 404)", () => {
    expect(isValidWebhookToken("token-xyz", "token-abc")).toBe(false);
  });

  it("verify token vacío jamás valida", () => {
    expect(isValidWebhookToken("", "")).toBe(false);
  });
});

describe("capa 2: firma x-hub-signature-256 (FR-042)", () => {
  const secret = "app-secret-de-prueba";
  const body = JSON.stringify({ object: "whatsapp_business_account" });

  function sign(payload: string, key: string): string {
    return `sha256=${createHmac("sha256", key).update(payload, "utf8").digest("hex")}`;
  }

  it("firma válida → pasa", () => {
    expect(isValidSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("firma inválida → rechaza (la ruta responde 401)", () => {
    expect(isValidSignature(body, sign(body, "otro-secreto"), secret)).toBe(
      false
    );
  });

  it("firma de otro body → rechaza", () => {
    expect(isValidSignature("{}", sign(body, secret), secret)).toBe(false);
  });

  it("header ausente con secreto configurado → rechaza", () => {
    expect(isValidSignature(body, null, secret)).toBe(false);
  });

  it("sin secreto configurado la primitiva es fail-closed → rechaza", () => {
    // Antes devolvía true (capa desactivada): cualquiera con la URL inyectaba.
    expect(isValidSignature(body, null, undefined)).toBe(false);
    expect(isValidSignature(body, "sha256=basura", undefined)).toBe(false);
    expect(isValidSignature(body, sign(body, ""), "")).toBe(false);
    expect(isValidSignature(body, sign(body, "   "), "   ")).toBe(false);
  });
});

describe("checkSignature: firma obligatoria salvo en el gate de pruebas", () => {
  const secret = "app-secret-de-prueba";
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const sign = (payload: string, key: string) =>
    `sha256=${createHmac("sha256", key).update(payload, "utf8").digest("hex")}`;

  it("sin secreto y fuera del gate → secret_missing (la ruta responde 503)", () => {
    expect(checkSignature(body, null, undefined, false)).toEqual({
      ok: false,
      reason: "secret_missing",
    });
    expect(checkSignature(body, sign(body, "x"), "", false)).toEqual({
      ok: false,
      reason: "secret_missing",
    });
  });

  it("sin secreto dentro del gate de pruebas → pasa", () => {
    expect(checkSignature(body, null, undefined, true)).toEqual({ ok: true });
  });

  it("con secreto se verifica SIEMPRE, también dentro del gate", () => {
    for (const allow of [false, true]) {
      expect(checkSignature(body, sign(body, secret), secret, allow)).toEqual({ ok: true });
      expect(checkSignature(body, null, secret, allow)).toEqual({
        ok: false,
        reason: "invalid_signature",
      });
      expect(checkSignature(body, sign(body, "otro"), secret, allow)).toEqual({
        ok: false,
        reason: "invalid_signature",
      });
    }
  });
});

describe("safeEqual", () => {
  it("longitudes distintas no lanzan", () => {
    expect(safeEqual("a", "aa")).toBe(false);
  });
});
