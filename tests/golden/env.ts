import os from "node:os";
import path from "node:path";

/**
 * Entorno de los golden: valores SINTÉTICOS y deterministas, sin heredar nada
 * del shell de quien corre (un META_APP_SECRET o un WAPI_BASE_URL locales
 * cambiarían el comportamiento registrado). Debe importarse ANTES que
 * cualquier módulo de la app (`getEnv()` memoriza el primer valor).
 *
 * Un archivo golden que necesite otra configuración (firma, Wapi, IA) la
 * fija con `vi.hoisted(...)`, que corre después de este módulo y antes de los
 * imports del archivo.
 */

const goldenUrl = process.env.DATABASE_URL_GOLDEN?.trim();
if (!goldenUrl) {
  // El global setup ya falló con el mensaje completo; esto evita que un
  // worker arranque contra la DATABASE_URL del desarrollador.
  throw new Error("[golden] Falta DATABASE_URL_GOLDEN (ver tests/golden/setup.ts)");
}

const INHERITED_TO_DROP = [
  "META_APP_SECRET",
  "META_APP_ID",
  "META_ES_CONFIG_ID",
  "META_GRAPH_API_VERSION",
  "WAPI_BASE_URL",
  "WAPI_API_KEY",
  "WAPI_ORG_IDS",
  "OPENROUTER_API_TOKEN",
  "OPENROUTER_MODEL",
  "OPENROUTER_JUDGE_MODEL",
  "WA_MOCK_ENABLED",
  "BOT_API_KEY",
  "EXPORT_API_KEY",
  "AGENT_COALESCE_MS",
  "AUTOMATIONS_TICK_MS",
  "SUPERADMIN_EMAILS",
  "ALLOW_SIGNUP",
];
for (const key of INHERITED_TO_DROP) delete process.env[key];

Object.assign(process.env, {
  TZ: "UTC",
  NODE_ENV: "test",
  DATABASE_URL: goldenUrl,
  APP_BASE_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "golden-synthetic-auth-secret-0001",
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "golden-verify-token-0001",
  // La firma del webhook es obligatoria fuera del gate de pruebas (y los
  // golden no abren el gate): todos los POST van firmados como los firmaría
  // Meta (`postWebhook` firma solo si hay secreto). Mismo valor que fija
  // webhook-auth.golden.test.ts.
  META_APP_SECRET: "golden-synthetic-app-secret-0001",
  // Hosts inexistentes: el fetch de los golden los intercepta, y cualquier
  // otro host queda bloqueado (jamás se llama a Meta ni a un proveedor real).
  META_GRAPH_BASE_URL: "https://graph.golden.test",
  OPENROUTER_BASE_URL: "https://ai.golden.test/api",
  MEDIA_DIR: path.join(os.tmpdir(), `vocero-golden-media-${process.pid}`),
});

export const GOLDEN_HOSTS = {
  graph: "graph.golden.test",
  wapi: "wapi.golden.test",
  ai: "ai.golden.test",
} as const;
