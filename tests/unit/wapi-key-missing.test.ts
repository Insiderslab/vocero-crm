import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorMessage } from "@/lib/api-error-message";

/**
 * C3 — organización bloqueada o clave Wapi ilegible: el error NO debe
 * presentarse como "Meta no está disponible" sino con un código dedicado
 * (wapi_key_missing), sin tocar la conexión (no reconnect_required) y sin
 * exponer ninguna clave.
 */

const { graphRequest, markReconnectRequired, getCredentialsByOrg, uploadGraphMedia, saveMediaFile, inserted } =
  vi.hoisted(() => ({
  graphRequest: vi.fn(),
  uploadGraphMedia: vi.fn(),
  saveMediaFile: vi.fn(),
  inserted: [] as Record<string, unknown>[],
  markReconnectRequired: vi.fn(),
  getCredentialsByOrg: vi.fn(),
  }));

vi.mock("@/server/whatsapp/media", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/whatsapp/media")>();
  return { ...original, uploadGraphMedia, saveMediaFile };
});

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

vi.mock("@/server/whatsapp/credentials", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/whatsapp/credentials")>();
  return { ...original, markReconnectRequired, getCredentialsByOrg };
});

/** Doble mínimo del DB para el envío de adjuntos: una conversación abierta y el insert registrado. */
function fakeDb() {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where"]) chain[m] = () => chain;
  chain.limit = async () => [
    {
      conversation: { id: "cv_1", organizationId: "org_a", isTest: false, lastInboundAt: new Date() },
      contact: { id: "ct_1", phone: "5215511111111", waUserId: null },
    },
  ];
  return {
    select: () => chain,
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        const row = { createdAt: new Date(), updatedAt: new Date(), ...v };
        return { returning: async () => [row] };
      },
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
}

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const db = fakeDb();
  return { ...actual, getDb: () => db };
});

const creds = {
  id: "c",
  organizationId: "org_a",
  wabaId: "W",
  phoneNumberId: "P",
  displayPhoneNumber: null,
  verifiedName: null,
  status: "connected" as const,
  onboardingMode: "manual" as const,
  appDisconnectedAt: null,
  token: "meta-token-segreto",
};

const missing = async () => {
  const { MetaApiError, WAPI_KEY_MISSING } = await import("@/lib/meta/client");
  return new MetaApiError("detalle interno", { status: 0, reason: WAPI_KEY_MISSING });
};
const plain0 = async () => {
  const { MetaApiError } = await import("@/lib/meta/client");
  return new MetaApiError("red caída", { status: 0 });
};

beforeEach(() => {
  graphRequest.mockReset();
  markReconnectRequired.mockReset();
  getCredentialsByOrg.mockReset();
  getCredentialsByOrg.mockResolvedValue(creds);
  uploadGraphMedia.mockReset();
  saveMediaFile.mockReset();
  saveMediaFile.mockResolvedValue("org_a/asset.png");
  inserted.length = 0;
});

describe("envío: código dedicado wapi_key_missing", () => {
  it("callGraphSend: clave Wapi ausente → wapi_key_missing, sin reconnect y sin detalle interno", async () => {
    graphRequest.mockRejectedValue(await missing());
    const { callGraphSend } = await import("@/server/inbox/send");
    const err = await callGraphSend(creds, { x: 1 }).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "SendError", code: "wapi_key_missing" });
    expect((err as Error).message).toMatch(/clave Wapi/i);
    expect((err as Error).message).not.toMatch(/Meta no está disponible/);
    expect((err as Error).message).not.toContain("detalle interno");
    expect(markReconnectRequired).not.toHaveBeenCalled();
  });

  it("control: un status 0 normal (red) sigue siendo meta_unavailable", async () => {
    graphRequest.mockRejectedValue(await plain0());
    const { callGraphSend } = await import("@/server/inbox/send");
    await expect(callGraphSend(creds, {})).rejects.toMatchObject({ code: "meta_unavailable" });
  });
});

describe("adjuntos: la subida con clave Wapi ausente tampoco se disfraza de fallo de subida", () => {
  it("sendMediaMessage → wapi_key_missing, mensaje failed con el texto dedicado y sin reconnect", async () => {
    uploadGraphMedia.mockRejectedValue(await missing());
    const { sendMediaMessage } = await import("@/server/inbox/send");
    const err = await sendMediaMessage({
      conversationId: "cv_1",
      organizationId: "org_a",
      file: { data: Buffer.from("x"), mimeType: "image/png" },
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "SendError", code: "wapi_key_missing" });
    const failed = inserted.find((v) => v.status === "failed");
    expect(failed?.error).toMatch(/clave Wapi/i);
    expect(markReconnectRequired).not.toHaveBeenCalled();
  });

  it("control: otro fallo de subida sigue siendo upload_failed", async () => {
    uploadGraphMedia.mockRejectedValue(await plain0());
    const { sendMediaMessage } = await import("@/server/inbox/send");
    await expect(
      sendMediaMessage({
        conversationId: "cv_1",
        organizationId: "org_a",
        file: { data: Buffer.from("x"), mimeType: "image/png" },
      })
    ).rejects.toMatchObject({ code: "upload_failed" });
  });
});

describe("plantillas: código dedicado wapi_key_missing", () => {
  it("createTemplate → wapi_key_missing (409), no meta_unavailable ni reconnect", async () => {
    graphRequest.mockRejectedValue(await missing());
    const { createTemplate, templateErrorStatus } = await import("@/server/whatsapp/templates");
    const err = await createTemplate("org_a", {
      name: "hola",
      language: "es",
      category: "UTILITY",
      body: "Hola",
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "TemplateError", code: "wapi_key_missing" });
    expect(templateErrorStatus(err as never)).toBe(409);
    expect(markReconnectRequired).not.toHaveBeenCalled();
  });

  it("syncTemplates → wapi_key_missing", async () => {
    graphRequest.mockRejectedValue(await missing());
    const { syncTemplates } = await import("@/server/whatsapp/templates");
    await expect(syncTemplates("org_a")).rejects.toMatchObject({ code: "wapi_key_missing" });
  });

  it("control: status 0 normal en syncTemplates sigue siendo meta_unavailable", async () => {
    graphRequest.mockRejectedValue(await plain0());
    const { syncTemplates } = await import("@/server/whatsapp/templates");
    await expect(syncTemplates("org_a")).rejects.toMatchObject({ code: "meta_unavailable" });
  });
});

describe("interfaz: el mensaje del servidor llega al usuario", () => {
  it("lee error.message del contrato de la API y no la raíz", () => {
    expect(apiErrorMessage({ error: { code: "wapi_key_missing", message: "Falta la clave" } }, "Error 409")).toBe(
      "Falta la clave"
    );
    expect(apiErrorMessage({ message: "raíz" }, "Error 409")).toBe("Error 409");
    expect(apiErrorMessage(null, "Error 409")).toBe("Error 409");
    expect(apiErrorMessage({ error: { message: "  " } }, "Error 409")).toBe("Error 409");
  });
});
