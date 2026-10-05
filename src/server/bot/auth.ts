import {
  API_KEY_SCOPES,
  authenticateApiKey,
  dbApiKeyAuthDeps,
  generateApiKey,
  hashApiKey,
  requireInstanceKey,
  type ApiKeyAuthDeps,
  type ApiKeyAuthResult,
} from "@/server/api-keys";

/**
 * Autenticación de la API de servicio `/api/bot/*`.
 *
 * Esta superficie NO la consume el navegador: la consume un cerebro externo
 * (un microservicio propio del operador) que quiere conducir la conversación
 * sin que el token de WhatsApp salga del CRM. Header `X-API-Key`.
 *
 * La lógica vive en `@/server/api-keys` (ámbito "bot"): clave por organización
 * `vbk_…`, o clave de instancia heredada `BOT_API_KEY` solo con UNA organización.
 */

export const BOT_KEY_PREFIX = API_KEY_SCOPES.bot.prefix;

/** Comprueba la clave de instancia heredada (`BOT_API_KEY`). null = válida. */
export const requireBotKey = (req: Request): Response | null => requireInstanceKey(req, "bot");

export const hashBotKey = hashApiKey;

export const generateBotKey = () => generateApiKey("bot");

export type BotAuthDeps = ApiKeyAuthDeps;
export const dbBotAuthDeps: BotAuthDeps = dbApiKeyAuthDeps;
export type BotAuthResult = ApiKeyAuthResult;

/** Puerta única de `/api/bot/*`: autentica y devuelve la organización. */
export function authenticateBot(
  req: Request,
  deps: BotAuthDeps = dbBotAuthDeps
): Promise<BotAuthResult | Response> {
  return authenticateApiKey(req, "bot", deps);
}
