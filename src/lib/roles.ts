/**
 * Reglas de rol puras (sin base de datos), importables desde el servidor y
 * desde componentes cliente. Una sola fuente para la API, la página y la
 * navegación de las claves de servicio: solo owner/admin.
 */
export function canManageApiKeys(role: string): boolean {
  return role === "owner" || role === "admin";
}
