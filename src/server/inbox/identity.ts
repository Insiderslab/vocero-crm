import {
  BSUID_PREFIX,
  getOrCreateWhatsappContact,
  type ResolvedIdentity,
} from "@/server/channels/core/identity";
import { resolveIdentity } from "@/server/channels/whatsapp/parse";

/**
 * Identidad resiliente de contacto (003).
 *
 * Meta está migrando la identidad de WhatsApp de teléfono a Business-Scoped
 * User IDs (BSUID): `wa_id`/`from` pasan a ser opcionales y aparecen
 * `from_user_id` (mensaje) y `user_id` (contacts[]).
 *
 * 005 (M1.3, T031): módulo DELGADO, mismas firmas exportadas. La extracción
 * pura vive en el adaptador (`channels/whatsapp/parse.ts`) y la resolución
 * contra la BD en el núcleo (`channels/core/identity.ts`, que en R2 lee
 * `contact_identity`).
 */

export { BSUID_PREFIX, resolveIdentity, type ResolvedIdentity };

/**
 * Resuelve o crea el contacto para una identidad, reconciliando teléfono y
 * BSUID (el `wa_identity` NO cambia) y reactivando archivados (salvo
 * `reactivate: false`, historial de la coexistence 009).
 */
export async function getOrCreateContactByIdentity(
  organizationId: string,
  resolved: ResolvedIdentity,
  opts: { reactivate?: boolean } = {}
) {
  return getOrCreateWhatsappContact(organizationId, resolved, opts);
}
