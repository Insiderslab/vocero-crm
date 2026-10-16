import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * FR-040/FR-080s: el token se guarda cifrado (jamás texto plano en la fila)
 * y a la UI solo viajan los últimos 4 caracteres.
 */

const insertedRows: Record<string, unknown>[] = [];
/** 005 (R1): sentencias de la doble escritura, y si corrieron DENTRO de la transacción. */
const mirrorCalls: { inTransaction: boolean }[] = [];
/** Filas divergentes que la postcondición de la copia devolverá (0 = idénticas). */
const mirror = { diverging: 0 };

vi.mock("@/lib/db", () => {
  // La escritura vieja y la doble escritura (channel_account) van en la
  // misma transacción. Desde R2 la copia es ESTRICTA: función SQL de la copia
  // + postcondición V1/V2 de esas filas (0 = idénticas), sin SAVEPOINT.
  const tx: Record<string, unknown> = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertedRows.push(v);
        return {
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve([{ id: "cred_test_1" }]),
          }),
        };
      },
    }),
    execute: () => {
      mirrorCalls.push({ inTransaction: true });
      return Promise.resolve([{ diverging: mirror.diverging }]);
    },
  };
  tx.transaction = (fn: (t: typeof tx) => Promise<unknown>) => fn(tx);
  return {
    getDb: () => ({
      transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    }),
    schema: {
      metaCredentials: { organizationId: "organization_id", id: "id" },
    },
  };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

describe("credenciales de WhatsApp", () => {
  it("saveCredentials cifra el token: la fila no contiene el texto plano", async () => {
    const { saveCredentials } = await import("@/server/whatsapp/credentials");
    const token = "EAAG-token-super-secreto-abcd";
    await saveCredentials({
      organizationId: "org_1",
      wabaId: "waba1",
      phoneNumberId: "pn1",
      token,
    });
    const row = insertedRows[0]!;
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(token);
    expect(row.tokenCipher).toBeTruthy();
    expect(row.tokenIv).toBeTruthy();
    expect(row.tokenTag).toBeTruthy();

    // y el cifrado es reversible con la clave de la instancia
    const { decryptSecret } = await import("@/lib/crypto");
    expect(
      decryptSecret({
        cipher: row.tokenCipher as string,
        iv: row.tokenIv as string,
        tag: row.tokenTag as string,
      })
    ).toBe(token);

    // 005: la copia a channel_account y su postcondición corren en la misma
    // transacción (R2: estricta).
    expect(mirrorCalls).toEqual([{ inTransaction: true }, { inTransaction: true }]);
  });

  it("005 (R2): si la copia en channel_account no queda idéntica, saveCredentials falla (y la transacción se deshace)", async () => {
    const { saveCredentials } = await import("@/server/whatsapp/credentials");
    const { ChannelMirrorError } = await import("@/server/channels/dual-write");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mirror.diverging = 1;
    try {
      const err = await saveCredentials({
        organizationId: "org_1",
        wabaId: "waba1",
        phoneNumberId: "pn1",
        token: "EAAG-token-otro-wxyz",
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ChannelMirrorError);
      const line = String(log.mock.calls[0]?.[0]);
      expect(line).toContain("channel_account");
      expect(line).not.toContain("EAAG-token-otro-wxyz");
    } finally {
      mirror.diverging = 0;
      log.mockRestore();
    }
  });

  it("tokenLast4 expone solo los últimos 4 caracteres", async () => {
    const { tokenLast4 } = await import("@/server/whatsapp/credentials");
    expect(tokenLast4("EAAG-token-super-secreto-abcd")).toBe("abcd");
  });
});
