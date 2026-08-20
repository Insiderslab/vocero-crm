import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Limpieza al arranque (FR-034): corridas del Laboratorio que quedaron
 * "running" tras un reinicio → fallidas. Solo corre en el runtime Node.
 */
export async function cleanupOrphanRuns(): Promise<void> {
  try {
    const db = getDb();
    const updated = await db
      .update(schema.agentTestRun)
      .set({
        status: "failed",
        error: "Interrumpida por un reinicio del servidor",
        finishedAt: new Date(),
      })
      .where(eq(schema.agentTestRun.status, "running"))
      .returning({ id: schema.agentTestRun.id });
    if (updated.length > 0) {
      console.log(
        `[boot] ${updated.length} corrida(s) del Laboratorio huérfana(s) marcada(s) como fallida(s)`
      );
    }
  } catch (err) {
    // La BD puede no estar lista aún (migraciones corren antes del server).
    console.error("[boot] limpieza de corridas huérfanas falló:", err);
  }
}

/**
 * Scheduler de automatizaciones (custom heili.cloud): corre el motor cada
 * AUTOMATIONS_TICK_MS (default 30 min). In-process como todo el trabajo en
 * segundo plano del proyecto (constitución II: sin colas externas). La
 * cadencia real por contacto la impone el motor, no el tick.
 */
export function startAutomationScheduler(): void {
  const tickMs =
    Number(process.env.AUTOMATIONS_TICK_MS ?? "") || 30 * 60 * 1000;
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // tick anterior aún vivo: no se apilan
    running = true;
    void import("@/server/automations/engine")
      .then((m) => m.runAllAutomations())
      .catch((err) => console.error("[automations] tick falló:", err))
      .finally(() => {
        running = false;
      });
  }, tickMs);
  // Que el intervalo no mantenga vivo el proceso en pruebas/scripts.
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[boot] scheduler de automatizaciones cada ${tickMs / 1000}s`);
}
