import { describe, expect, it } from "vitest";
import {
  decideOnFailure,
  retryStillValid,
  sentSinceLastInbound,
  shouldSendErrorReply,
} from "@/server/ai/failure";

/** 009 (E1) — Decisiones puras ante un fallo del proveedor de IA. */

describe("decideOnFailure", () => {
  const base = { error: "provider_error" as const, mode: "normal" as const, isTest: false, retryDelayMs: 60_000 };

  it("provider_error en un turno normal de una conversación real → segundo intento", () => {
    expect(decideOnFailure(base)).toBe("retry_later");
  });

  it("el segundo intento y el reintento manual NUNCA programan otro (no hay bucle)", () => {
    expect(decideOnFailure({ ...base, mode: "retry" })).toBe("handoff");
    expect(decideOnFailure({ ...base, mode: "manual" })).toBe("handoff");
  });

  it("salida inválida tras los 3 intentos de chatJson → humano, sin esperar", () => {
    expect(decideOnFailure({ ...base, error: "invalid_output" })).toBe("handoff");
  });

  it("Laboratorio → humano (resultado inmediato, como antes)", () => {
    expect(decideOnFailure({ ...base, isTest: true })).toBe("handoff");
  });

  it("con un segundo intento ya pendiente, otro fallo escala YA (no se rearma)", () => {
    expect(decideOnFailure({ ...base, retryAlreadyPending: true })).toBe("handoff");
  });

  it("AGENT_RETRY_MS=0 apaga el segundo intento", () => {
    expect(decideOnFailure({ ...base, retryDelayMs: 0 })).toBe("handoff");
  });
});

describe("retryStillValid", () => {
  it("solo si el último mensaje sigue siendo el entrante del turno fallido", () => {
    expect(retryStillValid("msg_1", { id: "msg_1", direction: "in" })).toBe(true);
  });

  it("un entrante nuevo o un saliente posterior lo invalidan (sin respuesta doble)", () => {
    expect(retryStillValid("msg_1", { id: "msg_2", direction: "in" })).toBe(false);
    expect(retryStillValid("msg_1", { id: "msg_3", direction: "out" })).toBe(false);
  });

  it("sin mensajes no se arriesga", () => {
    expect(retryStillValid("msg_1", undefined)).toBe(false);
    expect(retryStillValid(undefined, undefined)).toBe(false);
  });

  it("tras un reinicio (sin el id del entrante): vale si nadie contestó después del último entrante", () => {
    expect(retryStillValid(undefined, { id: "msg_9", direction: "in" })).toBe(true);
    expect(retryStillValid(undefined, { id: "msg_9", direction: "out" })).toBe(false);
  });
});

describe("shouldSendErrorReply", () => {
  const base = { text: "Te escribe una persona.", transitioned: true, isTest: false, alreadySent: false };

  it("con texto, en la transición, en una conversación real → se envía", () => {
    expect(shouldSendErrorReply(base)).toBe(true);
  });

  it("vacío = apagado", () => {
    expect(shouldSendErrorReply({ ...base, text: "" })).toBe(false);
    expect(shouldSendErrorReply({ ...base, text: "   " })).toBe(false);
    expect(shouldSendErrorReply({ ...base, text: null })).toBe(false);
  });

  it("una vez por handoff: sin transición o ya enviado → no", () => {
    expect(shouldSendErrorReply({ ...base, transitioned: false })).toBe(false);
    expect(shouldSendErrorReply({ ...base, alreadySent: true })).toBe(false);
  });

  it("Laboratorio → no", () => {
    expect(shouldSendErrorReply({ ...base, isTest: true })).toBe(false);
  });
});

describe("sentSinceLastInbound", () => {
  const text = "Te escribe una persona.";

  it("encuentra el texto entre el último entrante y ahora", () => {
    expect(
      sentSinceLastInbound(
        [
          { direction: "out", text },
          { direction: "in", text: "hola" },
        ],
        text
      )
    ).toBe(true);
  });

  it("lo enviado ANTES del último entrante no cuenta (nueva pregunta, nuevo aviso)", () => {
    expect(
      sentSinceLastInbound(
        [
          { direction: "in", text: "¿sigues ahí?" },
          { direction: "out", text },
        ],
        text
      )
    ).toBe(false);
  });

  it("otro texto no cuenta", () => {
    expect(sentSinceLastInbound([{ direction: "out", text: "otra cosa" }], text)).toBe(false);
  });
});

describe("arranque (vigilancia del código)", () => {
  it("el hook de arranque recupera los segundos intentos pendientes", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(path.resolve(import.meta.dirname, "..", "..", "src", "instrumentation.ts"), "utf8");
    expect(src).toMatch(/await recoverPendingAgentRetries\(\);/);
  });
});
