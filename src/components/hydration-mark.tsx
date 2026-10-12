"use client";

import { useEffect } from "react";

/**
 * 009 (E6) — Avisa al script de `lib/click-replay` de que React ya hidrató:
 * a partir de aquí los clics los procesa React, y el que llegó antes (si lo
 * hubo) se repite una vez.
 */
export function HydrationMark() {
  useEffect(() => {
    (window as unknown as { __heiliHydrated?: () => void }).__heiliHydrated?.();
  }, []);
  return null;
}
