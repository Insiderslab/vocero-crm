"use client";

import { createContext, useContext } from "react";

/**
 * Rol de la sesión en la organización activa, el que ya resuelve el layout de
 * (app) para el lateral: sin consultas nuevas. Solo sirve para ocultar enlaces;
 * los permisos los exigen la página y la API. Sin proveedor el rol es "" y no
 * se pinta nada reservado (fail-closed).
 */
const RoleContext = createContext("");

export const RoleProvider = RoleContext.Provider;

export function useRole(): string {
  return useContext(RoleContext);
}
