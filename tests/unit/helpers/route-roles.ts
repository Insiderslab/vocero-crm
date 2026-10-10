/**
 * Inventario de TODAS las rutas de `src/app/api/**`: qué política de acceso
 * tiene cada handler y por qué. Es la fuente de la tabla "ruta → rol
 * requerido" del registro de trabajo, y la lee `settings-routes-guard.test.ts`:
 * una ruta o un método nuevo sin entrada aquí hace fallar el test, y una
 * política que no coincide con la función que de verdad protege el handler
 * (leída del AST) también.
 *
 * Política → función que la implementa:
 *   admin          withAdminAuth   (owner/admin)      @/lib/api
 *   owner          withOwnerAuth   (solo owner)       @/lib/api
 *   member         withAuth        (cualquier miembro autenticado; el rol NO se mira)
 *   superadmin     withSuperadmin                     @/server/auth/superadmin
 *   export-key     withExport      (clave de export)  @/server/export/handler
 *   bot-key        authenticateBot (clave de bot)     @/server/bot/auth
 *   site-key       authenticateSiteKey (clave del sitio, 008) @/server/site-requests/auth
 *   session-stream requireSession  (canal SSE)        @/lib/auth/session
 *   webhook-token  isValidWebhookToken (+ firma)      @/server/inbox/webhook
 *   dev-mock       mockGuard       (404 en producción) @/lib/dev-guard
 *   public         ninguna, a propósito
 *
 * Criterio de reparto: owner/admin donde el efecto es sobre la CONFIGURACIÓN
 * de la organización (conexión, plantillas, agente, conocimiento, reglas de
 * envío masivo, claves, marca, equipo) o sobre Meta con las credenciales de la
 * organización fuera del trabajo diario de una conversación. Member donde se
 * trabaja con contactos, conversaciones y pipeline, y en las lecturas.
 */

import type { Guard } from "./route-scan";

export type Policy =
  | "admin"
  | "owner"
  | "member"
  | "superadmin"
  | "export-key"
  | "bot-key"
  | "site-key"
  | "session-stream"
  | "webhook-token"
  | "dev-mock"
  | "public";

/** Función y módulo que implementan cada política. */
export const POLICY_IMPL: Record<Policy, { name: string; module: string; via: "wrapper" | "call" } | null> = {
  admin: { name: "withAdminAuth", module: "@/lib/api", via: "wrapper" },
  owner: { name: "withOwnerAuth", module: "@/lib/api", via: "wrapper" },
  member: { name: "withAuth", module: "@/lib/api", via: "wrapper" },
  superadmin: { name: "withSuperadmin", module: "@/server/auth/superadmin", via: "wrapper" },
  "export-key": { name: "withExport", module: "@/server/export/handler", via: "wrapper" },
  "bot-key": { name: "authenticateBot", module: "@/server/bot/auth", via: "call" },
  "site-key": { name: "authenticateSiteKey", module: "@/server/site-requests/auth", via: "call" },
  "session-stream": { name: "requireSession", module: "@/lib/auth/session", via: "call" },
  "webhook-token": { name: "isValidWebhookToken", module: "@/server/inbox/webhook", via: "call" },
  "dev-mock": { name: "mockGuard", module: "@/lib/dev-guard", via: "call" },
  public: null,
};

type Row = [file: string, methods: string[], policy: Policy, why: string];

const ROWS: Row[] = [
  // Configuración de la conexión, claves, marca y equipo (settings)
  ["settings/whatsapp", ["GET", "PUT"], "admin", "credenciales y datos de la conexión de WhatsApp (Meta)"],
  ["settings/whatsapp/test", ["POST"], "admin", "prueba un token contra Meta"],
  ["settings/whatsapp/wapi-key", ["GET", "PUT", "DELETE"], "admin", "clave Wapi cifrada de la organización (C3)"],
  ["settings/whatsapp/embedded-signup", ["GET", "POST"], "admin", "Embedded Signup de Meta: canje del code y conexión del número (coexistence, 009)"],
  ["settings/webhook", ["GET"], "admin", "muestra el segmento secreto del webhook"],
  ["settings/bot-keys", ["GET", "POST"], "admin", "claves de servicio del bot"],
  ["settings/bot-keys/[id]", ["DELETE"], "admin", "revoca una clave del bot"],
  ["settings/export-keys", ["GET", "POST"], "admin", "claves de exportación"],
  ["settings/export-keys/[id]", ["DELETE"], "admin", "revoca una clave de exportación"],
  ["settings/site", ["GET", "PUT"], "admin", "formulario del sitio (008): clave activa y orígenes autorizados"],
  ["settings/site/key", ["POST", "DELETE"], "admin", "crea/rota o revoca la clave del sitio (008)"],
  ["settings/branding", ["PUT"], "owner", "marca de la organización: solo el propietario"],
  ["settings/branding/favicon", ["PUT", "DELETE"], "owner", "icono de la marca: solo el propietario"],
  ["settings/team", ["POST"], "owner", "alta de cuentas de equipo: solo el propietario"],
  ["settings/team", ["GET"], "member", "EXCEPCIÓN: lista nombre, correo y rol del propio equipo; la usa la pantalla de equipo para cualquier miembro"],
  ["settings/branding", ["GET"], "public", "EXCEPCIÓN: el login necesita la marca antes de autenticarse; devuelve solo la marca de la organización de la sesión"],

  // Fuera de settings, con efecto en la configuración o en Meta: owner/admin
  ["templates", ["POST"], "admin", "crea una plantilla y la envía a Meta con las credenciales de la organización"],
  ["templates/sync", ["POST"], "admin", "habla con Meta con las credenciales de la organización"],
  ["agent/profile", ["PUT"], "admin", "cambia nombre, tono, instrucciones, activación y acceso reservado (007) del agente de IA"],
  ["automations", ["POST"], "admin", "crea una regla de envío masivo de plantillas por Meta"],
  ["automations/[id]", ["PATCH", "DELETE"], "admin", "edita o borra una regla de envío masivo"],
  ["automations/run", ["POST"], "admin", "ejecuta ya las reglas: envía plantillas a los contactos por Meta"],
  ["kb", ["POST"], "admin", "el conocimiento es lo que el agente responde a los clientes"],
  ["kb/[id]", ["PATCH", "DELETE"], "admin", "idem: edita o borra conocimiento del agente"],
  ["lab/runs", ["POST"], "admin", "lanza el Laboratorio: gasta el proveedor de IA y crea datos de prueba"],
  ["lab/suggestions/apply", ["POST"], "admin", "aplica una sugerencia: escribe en el conocimiento del agente"],
  ["seed/demo", ["POST"], "admin", "carga el negocio demo en la organización"],
  ["seed/demo", ["GET", "DELETE"], "admin", "007: consulta y quita los datos demo de la organización"],

  // Trabajo diario con contactos, conversaciones y pipeline, y lecturas: cualquier miembro
  ["agent/profile", ["GET"], "member", "lectura del perfil del agente (sin secretos)"],
  ["templates", ["GET"], "member", "lista de plantillas: el miembro la necesita para enviar una en una conversación"],
  ["automations", ["GET"], "member", "lectura de las reglas"],
  ["automations/[id]/runs", ["GET"], "member", "lectura del historial de una regla"],
  ["kb", ["GET"], "member", "lectura del conocimiento"],
  ["kb/size", ["GET"], "member", "lectura del tamaño del conocimiento"],
  ["lab/runs", ["GET"], "member", "lectura de las corridas"],
  ["lab/runs/[id]", ["GET"], "member", "lectura de una corrida"],
  ["contacts", ["GET", "POST"], "member", "trabajo diario con contactos"],
  ["contacts/[id]", ["GET", "PATCH"], "member", "trabajo diario con contactos"],
  ["contacts/[id]/tags", ["PUT"], "member", "etiquetas de un contacto"],
  ["contacts/[id]/start-conversation", ["POST"], "member", "iniciar una conversación con plantilla (trabajo diario)"],
  ["conversations", ["GET"], "member", "bandeja"],
  ["conversations/[id]", ["PATCH"], "member", "estado de la conversación (leído, humano/IA)"],
  ["conversations/[id]/messages", ["GET", "POST"], "member", "leer y enviar mensajes: es el trabajo de un miembro"],
  ["conversations/[id]/messages/media", ["POST"], "member", "enviar un adjunto en una conversación"],
  ["conversations/[id]/messages/template", ["POST"], "member", "enviar una plantilla ya aprobada en una conversación"],
  ["pipeline/board", ["GET"], "member", "tablero"],
  ["pipeline/leads/[id]", ["PATCH"], "member", "mover y editar leads"],
  ["pipeline/stages", ["GET", "POST"], "member", "etapas del pipeline: el miembro trabaja el pipeline (decisión del owner si pasan a admin)"],
  ["pipeline/stages/[id]", ["PATCH", "DELETE"], "member", "etapas del pipeline: idem"],
  ["tags", ["GET", "POST"], "member", "etiquetas de contactos"],
  ["tags/[id]", ["DELETE"], "member", "etiquetas de contactos"],
  ["media/[assetId]", ["GET"], "member", "lectura de un adjunto de la propia organización"],
  ["my-orgs", ["GET"], "member", "organizaciones del propio usuario"],

  // Otras formas de autenticación
  ["admin/orgs", ["GET", "POST"], "superadmin", "panel de super-admin"],
  ["admin/orgs/[orgId]", ["PATCH"], "superadmin", "007: renombra una organización (panel de super-admin)"],
  ["admin/orgs/[orgId]/users", ["GET", "POST"], "superadmin", "panel de super-admin"],
  ["bot/context", ["GET"], "bot-key", "clave de servicio del bot, sin sesión"],
  ["bot/ficha", ["PUT"], "bot-key", "clave de servicio del bot"],
  ["bot/handoff", ["POST"], "bot-key", "clave de servicio del bot"],
  ["bot/media/[mediaId]", ["GET"], "bot-key", "clave de servicio del bot"],
  ["bot/messages", ["POST"], "bot-key", "clave de servicio del bot"],
  ["bot/profile", ["GET"], "bot-key", "clave de servicio del bot"],
  ["bot/reset", ["POST"], "bot-key", "clave de servicio del bot"],
  ["bot/typing", ["POST"], "bot-key", "clave de servicio del bot"],
  ["export/contacts", ["GET"], "export-key", "clave de exportación"],
  ["export/conversations", ["GET"], "export-key", "clave de exportación"],
  ["export/leads", ["GET"], "export-key", "clave de exportación"],
  ["export/messages", ["GET"], "export-key", "clave de exportación"],
  ["public/site-requests", ["POST"], "site-key", "formulario del sitio (008): la organización sale de la clave vsk_"],
  ["events", ["GET"], "session-stream", "canal SSE de la organización de la sesión"],
  ["webhooks/wa/[webhookToken]", ["GET", "POST"], "webhook-token", "Meta llama sin sesión: segmento secreto en la URL y firma"],

  // Públicas o solo de desarrollo
  ["auth/[...all]", ["GET", "POST"], "public", "Better Auth: registro, login, cierre de sesión"],
  ["health", ["GET"], "public", "comprobación de salud y versión, sin datos de clientes"],
  ["branding/favicon", ["GET"], "public", "icono de la pestaña; el login también lo necesita"],
  ["public/site-requests", ["OPTIONS"], "public", "preflight CORS del formulario del sitio (008): el navegador no manda la clave; solo responde a orígenes autorizados y no escribe nada"],
  ["dev/ai-mock/chat/completions", ["POST"], "dev-mock", "re-exporta el mock de v1, que lleva el guard"],
  ["dev/ai-mock/v1/chat/completions", ["POST"], "dev-mock", "mock de IA, 404 en producción"],
  ["dev/wa-mock/coexistence", ["POST"], "dev-mock", "mock de los webhooks de coexistence (009), 404 en producción"],
  ["dev/wa-mock/echo", ["POST"], "dev-mock", "mock de WhatsApp, 404 en producción"],
  ["dev/wa-mock/graph/[...path]", ["GET", "POST", "DELETE"], "dev-mock", "mock de la Graph API, 404 en producción"],
  ["dev/wa-mock/inbound", ["POST"], "dev-mock", "mock de WhatsApp, 404 en producción"],
  ["dev/wa-mock/media-file/[id]", ["GET"], "dev-mock", "mock de WhatsApp, 404 en producción"],
  ["dev/wa-mock/outbox", ["GET", "DELETE"], "dev-mock", "mock de WhatsApp, 404 en producción"],
  ["dev/wa-mock/status", ["POST"], "dev-mock", "mock de WhatsApp, 404 en producción"],
  ["dev/wa-mock/template-status", ["POST"], "dev-mock", "mock de WhatsApp, 404 en producción"],
];

export type RouteEntry = { file: string; method: string; policy: Policy; why: string };

/** Entradas planas, una por handler: clave "ruta:MÉTODO". */
export const ROUTE_ROLES: Record<string, RouteEntry> = Object.fromEntries(
  ROWS.flatMap(([file, methods, policy, why]) =>
    methods.map((method) => [`${file}:${method}`, { file, method, policy, why }] as const)
  )
);

/**
 * Dentro de `settings/**` solo pueden ser `member` o `public` los handlers de
 * esta lista (con su motivo, que es el `why` de la entrada).
 */
export const SETTINGS_EXCEPCIONES = ["settings/team:GET", "settings/branding:GET"];

/**
 * ¿El guard leído del AST implementa la política declarada? `alReexportar`
 * resuelve `export { X } from "./otra"` leyendo el handler del otro archivo.
 * Fail-closed: lo que no se sabe leer no cumple ninguna política salvo `public`.
 */
export function guardCumple(
  guard: Guard,
  policy: Policy,
  alReexportar: (from: string, as: string) => Guard | undefined
): boolean {
  const impl = POLICY_IMPL[policy];
  if (!impl) {
    // `public`: no debe llevar ninguna de las guardias conocidas (sería la política equivocada).
    return !(
      guard.kind === "wrapper" &&
      Object.values(POLICY_IMPL).some((i) => i?.name === guard.name && i.module === guard.module)
    );
  }
  switch (guard.kind) {
    case "wrapper":
      return impl.via === "wrapper" && guard.name === impl.name && guard.module === impl.module;
    case "body":
      return (
        impl.via === "call" &&
        guard.calls.some((c) => c.name === impl.name && c.module === impl.module)
      );
    case "reexport": {
      const destino = alReexportar(guard.from, guard.as);
      return destino ? guardCumple(destino, policy, alReexportar) : false;
    }
    default:
      return false;
  }
}
