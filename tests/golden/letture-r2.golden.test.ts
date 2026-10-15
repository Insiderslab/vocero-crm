import { describe, expect, it } from "vitest";
import { getSql } from "@/lib/db";
import { generateApiKey } from "@/server/api-keys";
import { sendText } from "@/server/inbox/send";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { GET as botContext } from "@/app/api/bot/context/route";
import { POST as botTyping } from "@/app/api/bot/typing/route";
import { waFixture } from "./fixtures/whatsapp";
import { conversationIdOf, postWebhook, recordedRequests } from "./harness";
import { ORG_A } from "./setup";

/**
 * 005-livello-canali (M1.3, T030) — Le letture di R2 vengono DAVVERO dalle
 * strutture nuove (plan §5.1–5.3). Con V1–V7 a 0 (modalità «blocca») le due
 * fonti sono uguali e i golden di comportamento non vedono la differenza: qui
 * le si separa apposta, a mano, per provare da dove legge ogni punto.
 * Asserzioni esplicite, nessuna istantanea.
 */

const sql = () => getSql();
const ANA = "525512345678";

describe("letture di R2", () => {
  it("Credentials è la vista di channel_account (non di meta_credentials)", async () => {
    await sql()`update channel_account set display_name = '+52 55 9999 0001' where organization_id = ${ORG_A}`;
    expect((await getCredentialsByOrg(ORG_A))?.displayPhoneNumber).toBe("+52 55 9999 0001");
  });

  it("il routing del webhook legge channel_account: un numero noto solo a meta_credentials non entra", async () => {
    await sql()`update channel_account set external_account_id = '100000000000099' where organization_id = ${ORG_A}`;
    await postWebhook(waFixture("inbound-text-mx")); // phone_number_id 100000000000001
    const [none] = await sql()<{ n: number }[]>`select count(*)::int as n from message`;
    expect(none?.n).toBe(0);
  });

  it("la risoluzione del contatto passa da contact_identity: telefono cambiato a mano → stesso contatto, riattivato", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    // Telefono cambiato e contatto archiviato: solo l'identità lo ritrova; la
    // via di ripiego della gara (INSERT in conflitto + rilettura) lo
    // ritroverebbe senza riattivarlo, quindi la riattivazione prova la via.
    await sql()`update contact set phone = '529999999999', archived_at = now()
                 where organization_id = ${ORG_A} and wa_identity = ${ANA}`;
    await postWebhook(waFixture("inbound-text-mx-again"));
    const rows = await sql()<{ contacts: number; messages: number; archived: number }[]>`
      select (select count(*)::int from contact where organization_id = ${ORG_A}) as contacts,
             (select count(*)::int from message where organization_id = ${ORG_A}) as messages,
             (select count(*)::int from contact where organization_id = ${ORG_A} and archived_at is not null) as archived
    `;
    expect(rows[0]).toEqual({ contacts: 1, messages: 2, archived: 0 });
  });

  it("gli stati si applicano per external_message_id (non per wa_message_id)", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    const cv = await conversationIdOf(ORG_A, ANA);
    await sendText({ conversationId: cv, organizationId: ORG_A, text: "hola" });
    // wa_message_id divergente apposta: solo external_message_id = wamid.golden.out.1
    await sql()`update message set wa_message_id = 'wamid.legacy.divergente' where external_message_id = 'wamid.golden.out.1'`;
    await postWebhook(waFixture("status-sent-delivered-read"));
    const [row] = await sql()<{ status: string }[]>`
      select status from message where external_message_id = 'wamid.golden.out.1'
    `;
    expect(row?.status).toBe("read");
  });

  it("bot: ?waIdentity= si risolve su contact_identity (DTO invariato) e «sta scrivendo» usa external_message_id", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    const key = generateApiKey("bot");
    await sql()`
      insert into bot_api_key (id, organization_id, label, scope, key_prefix, key_hash, created_by)
      values ('bk_golden_r2', ${ORG_A}, 'golden', 'bot', ${key.prefix}, ${key.hash}, 'golden')
    `;
    // Colonna vecchia divergente apposta: la lettura nuova trova lo stesso contatto.
    await sql()`update contact set wa_identity = 'vecchia-divergente' where organization_id = ${ORG_A} and wa_identity = ${ANA}`;
    const res = await botContext(
      new Request(`http://localhost:3000/api/bot/context?waIdentity=${ANA}`, {
        headers: { "x-api-key": key.plain },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contact: { waIdentity: string; name: string } };
    // Il DTO resta quello di oggi: `waIdentity` è la colonna del contatto fino a R3.
    expect(body.contact).toMatchObject({ name: "Ana Golden", waIdentity: "vecchia-divergente" });

    await sql()`update message set wa_message_id = null where external_message_id = 'wamid.golden.in.text.1'`;
    const cv = await conversationIdOf(ORG_A, "vecchia-divergente");
    const typing = await botTyping(
      new Request("http://localhost:3000/api/bot/typing", {
        method: "POST",
        headers: { "x-api-key": key.plain, "content-type": "application/json" },
        body: JSON.stringify({ conversationId: cv }),
      })
    );
    expect(await typing.json()).toEqual({ ok: true });
    const call = recordedRequests().find(
      (r) => r.method === "POST" && (r.body as { status?: string } | null)?.status === "read"
    );
    expect(call?.body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.golden.in.text.1",
      typing_indicator: { type: "text" },
    });
  });
});
