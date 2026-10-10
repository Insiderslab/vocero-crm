// El entorno sintético va PRIMERO: ningún módulo de la app debe leer el del shell.
import "./env";
import { rm } from "node:fs/promises";
import { afterAll, afterEach, beforeEach, vi } from "vitest";
import { getSql } from "@/lib/db";
import { resetHarness, teardownHarness, writeGoldenStores } from "./harness";

/**
 * `after()` de Next fuera de una petición real: se encola y el arnés lo
 * ejecuta al terminar la respuesta (`drainAfter`), igual que en producción.
 * Es un doble de la plataforma, no del código de la app.
 */
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (task: unknown) => {
      const g = globalThis as unknown as { __goldenAfter?: unknown[] };
      (g.__goldenAfter ??= []).push(task);
    },
  };
});

beforeEach(async () => {
  await resetHarness();
});

afterEach(async () => {
  await teardownHarness();
});

afterAll(async () => {
  writeGoldenStores();
  await getSql().end({ timeout: 5 });
  // Los adjuntos sintéticos que la app guardó en disco (MEDIA_DIR de env.ts).
  await rm(process.env.MEDIA_DIR!, { recursive: true, force: true });
});
