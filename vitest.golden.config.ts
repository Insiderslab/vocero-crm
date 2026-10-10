import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Golden de comportamiento de WhatsApp con PostgreSQL REAL (005-livello-canali,
 * ADR 0001 §3.7, plan §7.1). Comando: `pnpm test:golden`.
 *
 * - `DATABASE_URL_GOLDEN` es OBLIGATORIA: sin ella el global setup lanza un
 *   error claro y la corrida falla (nunca se salta: las Leyes prohíben los
 *   tests saltados).
 * - Una sola base de datos para todos los archivos: se ejecutan en serie
 *   (`fileParallelism: false`) y cada caso vacía las tablas y vuelve a sembrar
 *   las organizaciones A y B.
 * - `pnpm test` (vitest.config.ts) no incluye estos archivos.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/golden/**/*.golden.test.ts"],
    environment: "node",
    globalSetup: ["tests/golden/global-setup.ts"],
    setupFiles: ["tests/golden/setup-file.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
