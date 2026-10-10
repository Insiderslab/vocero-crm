/**
 * Reglas de rol puras (sin base de datos), importables desde el servidor y
 * desde componentes cliente. Una sola fuente: quién administra la
 * organización (owner/admin). Las claves de servicio y la conexión de
 * WhatsApp son vistas con nombre de esa misma regla.
 */
export function isOrgAdmin(role: string): boolean {
  return role === "owner" || role === "admin";
}

/** Claves de servicio (bot y export): solo owner/admin. */
export function canManageApiKeys(role: string): boolean {
  return isOrgAdmin(role);
}

/** Conexión de WhatsApp (credenciales, prueba, datos del webhook): solo owner/admin. */
export function canManageWhatsapp(role: string): boolean {
  return isOrgAdmin(role);
}
