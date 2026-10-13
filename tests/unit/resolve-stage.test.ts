import { describe, expect, it } from "vitest";
import { resolveStage } from "@/server/ai/actions";

/**
 * 009 (E2) — El modelo nombra la etapa en un idioma y la organización la tiene
 * sembrada en otro: misma clave de fábrica → misma etapa.
 */
const IT = [
  { id: "s_new", name: "Nuovo" },
  { id: "s_talk", name: "In conversazione" },
  { id: "s_int", name: "Interessato" },
  { id: "s_won", name: "Cliente" },
  { id: "s_lost", name: "Perso" },
];

describe("resolveStage", () => {
  it("exacto y sin mayúsculas, como siempre", () => {
    expect(resolveStage("Interessato", IT)?.id).toBe("s_int");
    expect(resolveStage("  interessato ", IT)?.id).toBe("s_int");
  });

  it("nombre de fábrica en otro idioma → la etapa con la misma clave", () => {
    expect(resolveStage("Interesado", IT)?.id).toBe("s_int");
    expect(resolveStage("interested", IT)?.id).toBe("s_int");
    expect(resolveStage("Perdido", IT)?.id).toBe("s_lost");
    expect(resolveStage("en conversación", IT)?.id).toBe("s_talk");
  });

  it("una etapa renombrada no se adivina; un nombre inventado no resuelve", () => {
    const renamed = [{ id: "s_x", name: "Caldo" }, { id: "s_new", name: "Nuovo" }];
    expect(resolveStage("Interesado", renamed)).toBeNull();
    expect(resolveStage("Cotizado", IT)).toBeNull();
  });
});
