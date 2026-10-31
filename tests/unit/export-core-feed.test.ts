import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 016 — `/api/export/core/*` (orbit.core-feed/v1): forma, minimizzazione,
 * Laboratorio escluso, cursore opaco e condizione keyset, isolamento tra
 * organizzazioni. Il DB è un proxy di Drizzle che registra l'SQL reale.
 */

const st = vi.hoisted(() => ({
  log: [] as { sql: string; params: unknown[] }[],
  keyOrg: "org_a",
  on: new Set<string>(),
  data: {} as Record<string, unknown[][]>,
}));

vi.mock("@/lib/db", async () => {
  const h = await import("./helpers/proxy-db");
  return h.makeProxyDb(st.log, (sql, params) => {
    if (/from "bot_api_key"/.test(sql)) return [["k_1", st.keyOrg, "export"]];
    if (/from "organization"/.test(sql)) return [[st.keyOrg, `Org ${st.keyOrg}`, `slug-${st.keyOrg}`]];
    const l = h.listeningRows(st.on, sql, params);
    if (l) return l;
    // La tabla principale: il primo FROM, salvo contacts, che ha la sottoquery
    // `contact_identity` già nella lista delle colonne.
    const table = /^select "id", "name", "phone"/.test(sql)
      ? "contact"
      : (/from "(\w+)"/.exec(sql)?.[1] ?? "");
        // Le righe di prova sono di org_a: le legge solo una query acotada a org_a.
    return params.includes("org_a") ? (st.data[table] ?? []) : [];
  });
});

import { GET as contacts } from "@/app/api/export/core/contacts/route";
import { GET as conversations } from "@/app/api/export/core/conversations/route";
import { GET as messages } from "@/app/api/export/core/messages/route";
import { GET as state } from "@/app/api/export/core/state/route";
import { generateApiKey } from "@/server/api-keys";
import { resetRateLimit } from "@/lib/rate-limit";
import { decodeCursor, encodeCursor, FEED_SCHEMA, keysetAfter, MICRO_ISO_FORMAT, microIso } from "@/server/listening/feed";
import { message as messageTable } from "@/lib/db/schema";

const key = generateApiKey("export");
const get = (h: (r: Request) => Promise<Response>, name: string, q = "") =>
  h(new Request(`http://localhost/api/export/core/${name}${q}`, { headers: { "x-api-key": key.plain } }));
const dataQueries = () => st.log.filter((q) => /^select/i.test(q.sql) && !/from "(bot_api_key|organization)"/.test(q.sql));

const CONTACT_ROW = (id: string, archived: string | null = null) => [
  id, "Ana", "5215511111111", "5215511111111", null, "ana@x.it", "anuncio",
  archived, "2026-10-01T10:00:00.000", "2026-10-02T10:00:00.000", "2026-10-03T10:00:00.123456Z",
];

beforeEach(() => {
  resetRateLimit();
  st.log.length = 0;
  st.keyOrg = "org_a";
  st.on = new Set(["org_a"]);
  st.data = {};
});

describe("state", () => {
  it("forma del contratto, con lo slug dalla chiave e l'ascolto dell'organizzazione", async () => {
    const body = await (await get(state, "state")).json();
    expect(body).toMatchObject({
      schema: FEED_SCHEMA,
      organizationId: "org_a",
      organizationSlug: "slug-org_a",
      listening: { enabled: true, enabledAt: "2026-10-31T10:00:00.000Z" },
    });
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
  });

  it("la chiave di B non legge l'ascolto di A", async () => {
    st.keyOrg = "org_b";
    const body = await (await get(state, "state")).json();
    expect(body.organizationId).toBe("org_b");
    expect(body.listening).toEqual({ enabled: false, enabledAt: null });
  });
});

describe("contacts", () => {
  it("campi esatti: niente note, ficha, tag né trattativa; con le identità", async () => {
    st.data.contact = [CONTACT_ROW("ct_1")];
    st.data.contact_identity = [["ct_1", "whatsapp", "5215511111111", null]];
    const body = await (await get(contacts, "contacts")).json();
    expect(body).toMatchObject({ schema: FEED_SCHEMA, organizationId: "org_a", listening: true });
    const [item] = body.items;
    expect(Object.keys(item).sort()).toEqual(
      ["changedAt", "createdAt", "email", "id", "identities", "name", "phone", "source", "updatedAt", "waIdentity", "waUserId"]
    );
    for (const banned of ["notes", "ficha", "tags", "stage", "priority"]) expect(item).not.toHaveProperty(banned);
    expect(item.identities).toEqual([{ channel: "whatsapp", externalId: "5215511111111", channelAccountId: null }]);
    expect(item.changedAt).toBe("2026-10-03T10:00:00.123Z");
    // La query non seleziona nemmeno le colonne sensibili.
    expect(dataQueries()[0]!.sql).not.toMatch(/"notes"|"ficha"/);
  });

  it("archiviato: solo { id, deleted: true, changedAt }", async () => {
    st.data.contact = [CONTACT_ROW("ct_1", "2026-10-03T10:00:00.000")];
    const body = await (await get(contacts, "contacts")).json();
    expect(body.items).toEqual([{ id: "ct_1", deleted: true, changedAt: "2026-10-03T10:00:00.123Z" }]);
  });

  it("changed_at = greatest(updated_at, archived_at, ultima identità), con la sottoquery acotada", async () => {
    await get(contacts, "contacts");
    const q = dataQueries()[0]!;
    expect(q.sql).toMatch(/greatest\("contact"\."updated_at", "contact"\."archived_at", \(\(select max\("created_at"\) from "contact_identity" where \("contact_identity"\."organization_id" = \$\d+ and "contact_identity"\."contact_id" = "contact"\."id"\)\)\)/);
  });

  it("negativo con due organizzazioni: la chiave di B non vede i contatti di A", async () => {
    st.data.contact = [CONTACT_ROW("ct_1")];
    st.keyOrg = "org_b";
    const body = await (await get(contacts, "contacts")).json();
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
    for (const q of dataQueries()) expect(q.params).not.toContain("org_a");
  });
});

describe("conversations", () => {
  it("campi esatti e channel; is_test escluso nella query", async () => {
    st.data.conversation = [["cv_1", "ct_1", "whatsapp", null, true, null, "2026-10-01T10:00:00.000", "2026-10-02T10:00:00.000", "2026-10-02T10:00:00.000000Z"]];
    const body = await (await get(conversations, "conversations")).json();
    expect(Object.keys(body.items[0]).sort()).toEqual(
      ["aiEnabled", "channel", "channelAccountId", "contactId", "createdAt", "id", "lastInboundAt", "updatedAt"]
    );
    const q = dataQueries()[0]!;
    expect(q.sql).toMatch(/"conversation"\."is_test" = \$(\d+)/);
    const n = Number(/"conversation"\."is_test" = \$(\d+)/.exec(q.sql)![1]);
    expect(q.params[n - 1]).toBe(false);
  });
});

describe("messages", () => {
  it("campi esatti, hasMedia booleano, nessun file né URL; is_test escluso", async () => {
    st.data.message = [["msg_1", "cv_1", "ct_1", "whatsapp", "in", "operator", false, "image", "ciao", null, "2026-10-02T10:00:00.000", true, "2026-10-02T10:00:00.000001Z"]];
    const body = await (await get(messages, "messages")).json();
    const [item] = body.items;
    expect(Object.keys(item).sort()).toEqual(
      ["aiGenerated", "channel", "contactId", "conversationId", "createdAt", "direction", "hasMedia", "id", "origin", "text", "type", "waTimestamp"]
    );
    expect(item.hasMedia).toBe(true);
    const q = dataQueries()[0]!;
    expect(q.sql).toMatch(/"conversation"\."is_test" = \$/);
    expect(q.sql).not.toMatch(/media_asset"/);
  });
});

describe("cursore e limite", () => {
  it("nextCursor = ultimo elemento (µs); riusarlo come after produce la condizione keyset", async () => {
    st.data.message = [["msg_9", "cv_1", "ct_1", "whatsapp", "out", "ai", true, "text", "hola", null, "2026-10-02T10:00:00.000", false, "2026-10-02T10:00:00.123456Z"]];
    const { nextCursor } = await (await get(messages, "messages")).json();
    expect(decodeCursor(nextCursor)).toEqual({ ts: "2026-10-02T10:00:00.123456Z", id: "msg_9" });

    st.log.length = 0;
    await get(messages, "messages", `?after=${nextCursor}&limit=7`);
    const q = dataQueries()[0]!;
    expect(q.sql).toMatch(/\("message"\."created_at", "message"\."id"\) > \(\$\d+::timestamp, \$\d+\)/);
    expect(q.params).toContain("2026-10-02T10:00:00.123456Z");
    expect(q.params).toContain("msg_9");
    expect(q.params).toContain(7);
  });

  it("pagina vuota → nextCursor null", async () => {
    expect((await (await get(messages, "messages")).json()).nextCursor).toBeNull();
  });

  const bad = [
    "%%%", // base64url sporco
    Buffer.from("non-una-data|msg_1").toString("base64url"),
    Buffer.from("Oct 2 2026 10:00:00|msg_1").toString("base64url"), // Date.parse la accetta, ma non è ISO
    Buffer.from("2026-13-45T10:00:00.000Z|msg_1").toString("base64url"),
    Buffer.from("2026-10-02T10:00:00.000Z|msg 1;drop").toString("base64url"),
    Buffer.from("2026-10-02T10:00:00.000Z").toString("base64url"),
    Buffer.from("2026-10-02T10:00:00.000Z|a|b").toString("base64url"),
    "",
  ];
  it.each(bad)("cursore malformato %j → 422 invalid_cursor senza toccare il database", async (after) => {
    for (const [h, n] of [[contacts, "contacts"], [conversations, "conversations"], [messages, "messages"]] as const) {
      st.log.length = 0;
      const res = await get(h, n, `?after=${encodeURIComponent(after)}`);
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("invalid_cursor");
      expect(dataQueries()).toEqual([]);
    }
  });

  it.each(["0", "1001", "-1", "abc", "5.5", ""])("limit %j → 422 senza dati", async (limit) => {
    const res = await get(messages, "messages", `?limit=${limit}`);
    expect(res.status).toBe(422);
    expect(dataQueries()).toEqual([]);
  });

  it.each(["1", "1000"])("limit %s accettato; default 500", async (limit) => {
    expect((await get(messages, "messages", `?limit=${limit}`)).status).toBe(200);
    expect(dataQueries()[0]!.params).toContain(Number(limit));
    st.log.length = 0;
    await get(messages, "messages");
    expect(dataQueries()[0]!.params).toContain(500);
  });
});

describe("keysetAfter: due pagine consecutive non ripetono né perdono a parità di created_at", () => {
  const dialect = new PgDialect();
  const render = (after: ReturnType<typeof decodeCursor>) =>
    dialect.sqlToQuery(keysetAfter(messageTable.createdAt, messageTable.id, after)!);

  it("confronto di tupla (ts, id) > (cursore): stesso ts → decide l'id, strettamente maggiore", () => {
    const q = render({ ts: "2026-10-02T10:00:00.000500Z", id: "msg_b" });
    expect(q.sql).toBe('("message"."created_at", "message"."id") > ($1::timestamp, $2)');
    expect(q.params).toEqual(["2026-10-02T10:00:00.000500Z", "msg_b"]);
  });

  it("senza cursore: nessuna condizione", () => {
    expect(keysetAfter(messageTable.createdAt, messageTable.id, null)).toBeUndefined();
  });

  it("encode/decode simmetrici", () => {
    expect(decodeCursor(encodeCursor("2026-10-02T10:00:00.000500Z", "msg_b"))).toEqual({
      ts: "2026-10-02T10:00:00.000500Z",
      id: "msg_b",
    });
  });
});

describe("verifica avversaria del 31/10: guardie che nessun test copriva", () => {
  const dialect = new PgDialect();

  it("il cursore usa i microsecondi (US), mai i millisecondi (MS)", () => {
    expect(MICRO_ISO_FORMAT).toMatch(/SS\.US"Z"$/);
    const q = dialect.sqlToQuery(microIso(messageTable.createdAt));
    expect(q.sql).toBe(`to_char("message"."created_at", '${MICRO_ISO_FORMAT}')`);
  });

  it("date impossibili → cursore non valido (422 senza toccare il database)", () => {
    expect(decodeCursor(encodeCursor("2026-02-31T00:00:00Z", "msg_1"))).toBeNull();
    expect(decodeCursor(encodeCursor("0000-01-01T00:00:00Z", "msg_1"))).toBeNull();
    expect(decodeCursor(encodeCursor("2026-10-02T24:00:00Z", "msg_1"))).toBeNull();
  });

  it("422 sulla rotta con una data impossibile, nessuna query di dati", async () => {
    const res = await get(messages, "messages", `?after=${encodeCursor("2026-02-31T00:00:00Z", "msg_1")}`);
    expect(res.status).toBe(422);
    expect(dataQueries()).toHaveLength(0);
  });

  it("base64url non canonico (padding o carattere in più) → non valido", () => {
    const good = encodeCursor("2026-10-02T10:00:00.000500Z", "msg_b");
    expect(decodeCursor(good)).not.toBeNull();
    expect(decodeCursor(`${good}=`)).toBeNull();
    expect(decodeCursor(`${good}A`)).toBeNull();
  });

  it("la busta delle liste porta lo stato vero dell'ascolto (acceso e spento)", async () => {
    expect((await (await get(messages, "messages")).json()).listening).toBe(true);
    st.on = new Set();
    expect((await (await get(messages, "messages")).json()).listening).toBe(false);
  });

  it("messaggi e conversazioni escludono i contatti archiviati (sono deleted per il Core)", async () => {
    for (const [handler, name] of [[messages, "messages"], [conversations, "conversations"]] as const) {
      st.log.length = 0;
      await get(handler, name);
      const q = dataQueries()[0]!;
      expect(q.sql).toMatch(/inner join "contact" on \("contact"\."organization_id" = \$\d+ and "contact"\."id" = [^)]*"contact_id" and "contact"\."archived_at" is null\)/);
    }
  });
});
