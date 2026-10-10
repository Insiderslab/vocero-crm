import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import { deliverToWebhook } from "@/server/dev/wa-mock-inbound";

export const dynamic = "force-dynamic";

/**
 * 009 — Simula los webhooks propios de la coexistence (`history`,
 * `smb_app_state_sync`, `account_update`). Envuelve el `value` en el sobre de
 * Meta y lo entrega FIRMADO al webhook real. Solo en pruebas (dev-guard).
 */
const schema = z.object({
  field: z.enum(["history", "smb_app_state_sync", "account_update"]),
  phoneNumberId: z.string().min(1),
  /** Por defecto, la WABA de la conexión guardada para ese número. */
  wabaId: z.string().optional(),
  value: z.record(z.unknown()),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const creds = await getCredentialsByPhoneNumberId(body.data.phoneNumberId);
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: body.data.wabaId ?? creds?.wabaId ?? "WABA-MOCK",
        changes: [
          {
            field: body.data.field,
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "393470000000",
                phone_number_id: body.data.phoneNumberId,
              },
              ...body.data.value,
            },
          },
        ],
      },
    ],
  };
  const res = await deliverToWebhook(payload);
  if (!res.ok) {
    return apiError(502, "webhook_error", `El webhook respondió ${res.status}`);
  }
  return Response.json({ delivered: true });
}
