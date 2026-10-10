/**
 * Reglas de rol puras (sin base de datos), importables desde el servidor y
 * desde componentes cliente. Una sola fuente: quién administra la
 * organización (owner/admin) y quién es su propietario (solo owner). Las
 * claves de servicio y la conexión de WhatsApp son vistas con nombre de la
 * primera regla.
 */
export function isOrgAdmin(role: string): boolean {
  return role === "owner" || role === "admin";
}

/** Solo el propietario (marca, alta de cuentas de equipo): más estricto que owner/admin. */
export function isOrgOwner(role: string): boolean {
  return role === "owner";
}

/** Claves de servicio (bot y export): solo owner/admin. */
export function canManageApiKeys(role: string): boolean {
  return isOrgAdmin(role);
}

/** 008 — Formulario del sitio (clave vsk_ y orígenes): solo owner/admin. */
export function canManageSiteForm(role: string): boolean {
  return isOrgAdmin(role);
}

/** Conexión de WhatsApp (credenciales, prueba, datos del webhook): solo owner/admin. */
export function canManageWhatsapp(role: string): boolean {
  return isOrgAdmin(role);
}
