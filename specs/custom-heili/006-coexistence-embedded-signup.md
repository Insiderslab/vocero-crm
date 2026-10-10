# Fase 5 — Coexistence: app WhatsApp Business del teléfono + CRM (Embedded Signup)

> Customización sobre el fork desplegado en crm.heili.cloud.
> **Estado: ✅ IMPLEMENTADA** (2026-10-10), rama `claude/exciting-rubin-mow1yu`, rebasada sobre `main` tras la unión de la PR #3 (C1–C3, roles). Gate técnico + self-test E2E verdes (sección "009" de `scripts/e2e-selftest.mjs`).
> **Carril: COMPLETO** — migración `drizzle/0012_quiet_warpath.sql` (renumerada: 0009–0011 son de C1–C3).
> En el plan multicanal (`docs/piani/PIANO-CRM-MULTICANALE.md`) es la **parte coexistence del paquete K2** (WhatsApp con Embedded Signup v4). Las rutas nuevas usan `withAdminAuth` (fuente única del 403).

**Constitution Check**: dependencias de runtime solo Meta (II ✔️ — el SDK JS
de Meta es parte de la WhatsApp Cloud API; sin servicios nuevos); secretos
(I ✔️ — el `code` se canjea en el servidor con App Secret, el token se cifra
con AES-256-GCM y jamás llega al navegador; App ID y Config ID no son
secretos); multi-tenancy (III ✔️ — toda fila nueva lleva `organization_id`, el
webhook enruta por `phone_number_id`); idempotencia (IV ✔️ — historial dedup
por `wa_message_id` UNIQUE, agenda por `(organization_id, wa_identity)`).

**Input**: decisión del owner 2026-10-09 — "voglio che l'app sul telefono e il
CRM coesistano: gestirlo sia nel CRM sia dall'altra parte". Número piloto:
+39 347 718 5235 (InsidersLab, hoy en la app WhatsApp Business).

## User Scenarios & Testing

### US1 — Conectar el número de la app con un botón (P1)
El owner/admin entra a Configuración → WhatsApp, pulsa **"Conectar con
Meta"**, inicia sesión con Facebook en la ventana de Meta, elige el número de
su app WhatsApp Business y confirma en el teléfono. Vuelve al CRM con
"Número … conectado (app + CRM)". El número sigue funcionando en la app.

**AC**
1. Sin `META_APP_ID` + `META_ES_CONFIG_ID` + `META_APP_SECRET` el botón NO
   aparece y el wizard manual funciona igual.
2. El `code` se canjea en el servidor; el navegador jamás recibe el token. La
   UI muestra solo `…last4`.
3. Si el popup no trae `phone_number_id`, se deduce de la WABA cuando tiene
   un solo número; con varios → error claro, sin guardar nada.
4. Code vencido/rechazado → 422 `code_exchange_failed`; la conexión anterior
   queda intacta.
5. Número ya conectado a OTRA organización de la instancia → 409.
6. Solo owner/admin (403 al resto).
7. En coexistence NO se llama a `/register`; sí a `subscribed_apps` y a
   `POST {phone}/smb_app_data` (`smb_app_state_sync`, luego `history`).
8. Re-guardar a mano el mismo número (token nuevo) conserva el modo
   coexistence; cambiar de número vuelve a `manual`.

### US2 — Historial de la app en el CRM (P1)
Si el negocio comparte el historial (hasta 180 días), los chats entran como
hilos del inbox.

**AC**
1. Entrantes del cliente = `in`; lo que escribió el dueño = `out`,
   `origin=manual`.
2. El historial NO abre la ventana de 24 h, NO suma no-leídos, NO crea leads
   en el pipeline y NO despierta a la IA.
3. Bloque repetido → sin duplicados.
4. Historial no compartido (código 2593109) → 200, sin efectos.
5. Adjuntos: se guarda el pie/nombre como texto; el binario NO se descarga
   (evita llenar el volumen con 6 meses de fotos).
6. El hilo se ordena por su último mensaje (sin retroceder si ya hay uno más
   nuevo).

### US3 — Agenda del teléfono (P2)
**AC**
1. La agenda NO crea contactos ni conversaciones (trae amigos y familia).
2. Se guarda en `wa_address_book_entry` y da nombre a un contacto cuando
   escribe por primera vez o aparece en el historial.
3. Un contacto existente toma el nombre de la agenda solo si el suyo es de
   relleno (su teléfono o "Contacto de WhatsApp"); el puesto por el operador
   se respeta.
4. `action=remove` borra la entrada (no el contacto).

### US4 — Aviso de corte de la coexistence (P2)
**AC**
1. `account_update` con `PARTNER_REMOVED` o `ACCOUNT_OFFBOARDED` →
   `meta_credentials.app_disconnected_at` y banner rojo en Configuración →
   WhatsApp ("abre la app y vuelve a conectar con Meta").
2. `ACCOUNT_RECONNECTED` o reconectar → se limpia.
3. Otros eventos de `account_update` se ignoran.
4. Con coexistence activa, la tarjeta del número muestra "App + CRM" y el
   recordatorio de abrir la app al menos cada 13 días.

### Ya existente (008)
Los mensajes que el dueño manda a mano desde la app (`smb_message_echoes`)
entran como `out`/`manual` y pausan la IA de esa conversación.

## Diseño

| Pieza | Archivo |
|---|---|
| Env `META_APP_ID`, `META_ES_CONFIG_ID` | `src/lib/env.ts`, `.env.example` |
| Canje del code (sin bearer, App ID + Secret) | `src/lib/meta/client.ts` → `exchangeEmbeddedSignupCode` |
| Orquestación del alta | `src/server/whatsapp/embedded-signup.ts` |
| API `GET/POST /api/settings/whatsapp/embedded-signup` | `src/app/api/settings/whatsapp/embedded-signup/route.ts` |
| Webhooks `history`, `smb_app_state_sync`, `account_update` | `src/server/inbox/coexistence.ts` + despacho en `src/app/api/webhooks/wa/[webhookToken]/route.ts` |
| Nombre desde la agenda al crear contacto | `src/server/inbox/identity.ts` |
| UI | `src/components/settings/coexistence-connect.tsx`, `whatsapp-wizard.tsx`, i18n es/en/it |
| Esquema | `meta_credentials.onboarding_mode`, `meta_credentials.app_disconnected_at`, tabla `wa_address_book_entry` |
| Mocks | `wa-mock/graph` (`oauth/access_token`, `{waba}/phone_numbers`, `{phone}/smb_app_data`), `wa-mock/coexistence` |

Popup (SDK JS de Meta): `FB.login(cb, { config_id, response_type: "code",
override_default_response_type: true, extras: { setup: {}, featureType:
"whatsapp_business_app_onboarding", sessionInfoVersion: "3" } })`. Los IDs
llegan por `postMessage` (`type: WA_EMBEDDED_SIGNUP`, evento `FINISH…`),
aceptado solo desde `*.facebook.com`.

## Requisitos fuera del código (Meta)
1. App de Meta con **Facebook Login for Business** → configuración
   "WhatsApp Embedded Signup" → su Configuration ID = `META_ES_CONFIG_ID`.
2. Dominio del CRM en "Dominios permitidos para el SDK de JavaScript".
3. Campos de webhook: `messages`, `message_template_status_update`,
   `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`.
4. Con acceso estándar el popup solo funciona para quien tiene rol en la app
   (suficiente para el número propio de InsidersLab). Para clientes:
   **Tech Provider** (verificación del negocio, App Review con acceso
   avanzado a `whatsapp_business_management` y `whatsapp_business_messaging`,
   verificación de acceso).
5. Meta exige pedir agenda e historial dentro de ~24 h del alta; si se
   pierde, hay que desconectar y repetir el alta.

## Fuera de alcance
- Alta de números NUEVOS (no de la app) por Embedded Signup: requiere
  `/register` con PIN — se sigue usando el wizard manual.
- Descarga de adjuntos del historial; mensajes editados/borrados
  (`edit`/`revoke`) en echoes.
- Re-sincronización manual de agenda/historial (Meta solo la permite una vez
  por alta).

## Pendiente de verificar en vivo (no se puede con mocks)
- Forma exacta del `postMessage` final (si trae `phone_number_id`; el código
  tolera que no).
- Que Meta acepte la suscripción a `account_update`/`history`/
  `smb_app_state_sync` en la app `609974691965875`.
- Nombres exactos de los eventos de corte (`PARTNER_REMOVED`,
  `ACCOUNT_OFFBOARDED`, `ACCOUNT_RECONNECTED`): tomados de documentación de
  terceros; si llega otro, se ve en el log `[webhook]` y no rompe nada.
