import { describe, expect, it } from "vitest";
import { serializeMessage } from "@/server/inbox/ingest";

/**
 * 005-livello-canali (M1.3, T033) — DTO del mensaje: `channel` es el ÚNICO
 * campo nuevo (aditivo, FR-010) y los de antes no cambian.
 */
const row = {
  id: "msg_1",
  organizationId: "org_1",
  conversationId: "cv_1",
  waMessageId: "wamid.1",
  channel: "whatsapp" as const,
  externalMessageId: "wamid.1",
  direction: "in" as const,
  type: "text",
  text: "hola",
  status: "delivered" as const,
  error: null,
  aiGenerated: false,
  origin: "operator" as const,
  mediaAssetId: null,
  waTimestamp: new Date("2030-01-01T11:59:00Z"),
  createdAt: new Date("2030-01-01T12:00:00Z"),
};

describe("serializeMessage (DTO de la API y del SSE)", () => {
  it("añade solo `channel`; el resto es el DTO de siempre", () => {
    expect(serializeMessage(row as never)).toEqual({
      id: "msg_1",
      conversationId: "cv_1",
      direction: "in",
      type: "text",
      text: "hola",
      status: "delivered",
      error: null,
      aiGenerated: false,
      origin: "operator",
      channel: "whatsapp",
      media: null,
      createdAt: "2030-01-01T11:59:00.000Z",
    });
  });

  it("nunca expone los IDs externos del proveedor", () => {
    const dto = serializeMessage(row as never) as Record<string, unknown>;
    expect(dto).not.toHaveProperty("waMessageId");
    expect(dto).not.toHaveProperty("externalMessageId");
  });
});
