# Fase 4 — Integración Wapi (canal WhatsApp vía gateway propio)

> Decisión de arquitectura (2026-08-20): el CRM se conectará a WhatsApp a
> través de **Wapi**, el gateway propio del ecosistema Heili (`wapi-app`,
> desplegado en el mismo VPS, código en `/opt/wapi`), en vez de hablar
> directamente con la Meta Cloud API. Estado: **✅ implementada (2026-08-20)**,
> pendiente de despliegue y de configurar los endpoints en producción.
>
> **Verificación:** gate técnico verde (typecheck/lint/build + 259 tests) y
> self-test E2E comportamental 87/87 + custom-heili 40/40, en BD limpia, en
> DOS modos: (a) Meta directo vía wa-mock (regresión) y (b) con
> `WAPI_BASE_URL` apuntando al wa-mock — el desvío ejercita el transporte
> nuevo con la misma forma Graph (enviar texto/media/plantilla, subir y
> descargar media, typing). Wapi a su vez: `tsc` + `eslint` + `next build`
> verdes.
>
> **Decisiones cerradas (2026-08-20):**
> 1. **Push**: Wapi reenvía el payload Meta *crudo* al webhook del CRM.
> 2. **Firma HMAC**: Wapi firma el reenvío con `x-hub-signature-256`
>    (sha256=HMAC(body, secreto)) — el secreto del endpoint en Wapi = el
>    `META_APP_SECRET` del CRM, así el verificador existente no cambia.
> 3. **Credenciales Meta viven solo en Wapi** (tabla `phone_numbers`, por
>    número). El CRM enruta por `phoneNumberId`/`wabaId` y nunca ve el token.
> 4. **Wapi = tubo, CRM = cerebro**: la ventana de 24 h, dedup, estados
>    monotónicos y sandbox del Laboratorio se quedan en el CRM.

## Contexto

- Wapi es hoy una app Next.js 16 ("whatsapp-platform") en etapa temprana:
  multi-cliente (cada número con SUS credenciales en BD), envío de texto vía
  Meta Cloud API, webhook y `POST /api/v1/messages`. Solo cubre **envío de
  texto**.
- El CRM usa de Meta mucho más que texto: ingestión de entrantes (webhook),
  plantillas (crear/sincronizar/estado), media (subida/descarga), estados de
  entrega, ventana de 24 h, ecosistema `wa-mock` para el self-test.

## Razón

Coherente con el documento del ecosistema Heili: Wapi abstrae los canales
(WhatsApp hoy, Instagram/Facebook/email mañana) detrás de UNA interfaz
interna. El CRM deja de conocer Meta: si mañana el canal cambia (o se agrega
otro), solo cambia Wapi.

## Diseño implementado (v1)

### Lado Wapi

1. **Proxy Graph-shaped** `ANY /api/v1/graph/{version}/{...path}`:
   - Auth: `Authorization: Bearer <api_key>` (hash SHA-256, misma tabla
     `api_keys` que `v1/messages`).
   - Routing: primer segmento = `meta_phone_number_id` → credenciales de ese
     número (debe pertenecer a la org de la key); si no, = `waba_id` → número
     de la org con ese WABA. Caso especial `_media/{phnId}/{mediaId}`:
     descarga binaria (ver abajo).
   - Reenvía a `graph.facebook.com` con el token del número y **retransmite el
     error de Meta tal cual** (status + JSON) → el CRM conserva su semántica
     de errores (`MetaApiError.isAuthError` → reconnect_required).
   - `GET {mediaId}` (un segmento): meta del media probando los números de la
     org; reescribe `url` al propio Wapi (`_media/{phn}/{mediaId}`) para que
     la descarga binaria también pase por el gateway.
   - `POST {phoneNumberId}/media` (multipart) y `POST {phoneNumberId}/messages`
     (texto, plantilla, media por id, read/typing) pasan transparentes.
2. **Webhook Meta → CRM (push)**:
   - Verificación de la firma entrante `X-Hub-Signature-256` contra
     `META_APP_SECRET` (opcional, como en el CRM).
   - Reenvío del payload **crudo** a los `webhook_endpoints` activos de la org
     (entradas agrupadas por org vía `phone_number_id`/`waba_id`), firmado con
     `x-hub-signature-256: sha256=HMAC(body, endpoint.secret)`. Con
     `endpoint.secret = META_APP_SECRET` del CRM, el verificador actual del CRM
     (`/api/webhooks/wa/<token>`) acepta sin cambios. Sigue guardando en su
     propia BD para el inbox de Wapi.

### Lado CRM

3. **Adaptador en el transporte único** (`src/lib/meta/client.ts`):
   - `graphRequest` (y el upload multipart / descarga de media) resuelven base
     URL y bearer en un solo punto: si `WAPI_BASE_URL` existe →
     `{WAPI_BASE_URL}/{version}/{path}` con `Authorization: Bearer
     {WAPI_API_KEY}`; si no → comportamiento actual (Meta directo /
     wa-mock vía `META_GRAPH_BASE_URL`).
   - **Migración por org**: `WAPI_ORG_IDS=id1,id2` limita el desvío a esas
     orgs; vacía/ausente = todas. La org se pasa desde los callers
     (`credentials.organizationId`), sin cambio de schema.
   - `connect.ts` (wizard de conexión) sigue yendo a Meta directo: con Wapi el
     alta de números vive en el panel de Wapi.
   - El segmento de versión se mantiene en la URL → el wa-mock sigue
     funcionando igual y el self-test E2E corre sin tocar nada real (con
     `WAPI_BASE_URL` apuntando al wa-mock se prueba también el desvío).

### Variables nuevas

- CRM: `WAPI_BASE_URL`, `WAPI_API_KEY`, `WAPI_ORG_IDS` (todas opcionales).
- Wapi: `META_APP_SECRET` (opcional, verificación firma entrante).

## Fuera de alcance (v1)

Instagram/Facebook, cambios de UI, migración de credenciales cifradas ya
guardadas en el CRM (quedan inertes: con Wapi activo el bearer lo pone el
gateway; se limpiarán cuando se complete la migración de todas las orgs).

## Checklist de despliegue (producción)

1. **Wapi** (`/opt/wapi`, contenedor `wapi-app`): desplegar esta versión;
   opcional `META_APP_SECRET` para verificar la firma entrante de Meta. En
   Meta for Developers, apuntar el webhook de la app a Wapi
   (`https://wapi.heili.cloud/api/webhook`, verify token =
   `WEBHOOK_VERIFY_TOKEN` de Wapi).
2. **Alta del número en Wapi** (panel admin): la org Heili ya tiene su API
   key; dar de alta cada número con su `meta_phone_number_id`, `waba_id` y
   token de Meta.
3. **Endpoint de reenvío**: en Wapi, agregar a la org el webhook del CRM
   `https://crm.heili.cloud/api/webhooks/wa/<META_WEBHOOK_VERIFY_TOKEN>` con
   `secret` = `META_APP_SECRET` del CRM (o configurar uno y ponerlo en ambos).
4. **CRM** (crm.heili.cloud):
   `WAPI_BASE_URL=https://wapi.heili.cloud/api/v1/graph`,
   `WAPI_API_KEY=hlp_live_<key de la org Heili>` y, para migración gradual,
   `WAPI_ORG_IDS=<org que migra>`. Sin `WAPI_BASE_URL` todo sigue igual.
5. **Verificación en vivo**: enviar texto, plantilla y adjunto desde el CRM;
   entrante real debe llegar vía Wapi al inbox del CRM; estados
   sent→delivered→read avanzan; en Wapi, el inbox propio sigue registrando.

## Addendum C3 (2026-10-10) — clave Wapi por organización

La `WAPI_API_KEY` global con `WAPI_ORG_IDS` vacía (= "todas las orgs") hacía que
varias organizaciones del CRM usaran la clave de UNA organización de Wapi (fuga
de aislamiento entre clientes). Desde C3:

- Cada organización guarda **su** clave `hlp_live_…` (tabla `wapi_credentials`,
  AES-256-GCM con la `ENCRYPTION_KEY` de la instancia, gestionada por
  owner/admin en Ajustes → WhatsApp, API `/api/settings/whatsapp/wapi-key`).
  La clave en claro no sale nunca en una respuesta (solo los últimos 4).
- Enrutamiento, con `WAPI_BASE_URL` definida: clave propia → Wapi con esa clave;
  sin clave propia → la global solo en **modo heredado** (`WAPI_ORG_IDS` con
  exactamente UNA organización, y es esa); `WAPI_ORG_IDS` con varias
  organizaciones y sin clave propia → bloqueada (no se hace ninguna llamada);
  cualquier otro caso → Meta directo con el token propio. Sin `WAPI_BASE_URL`
  todo va directo a Meta.
- La descarga de media solo envía la clave de Wapi a una URL del propio gateway
  (mismo origen que `WAPI_BASE_URL`) y el token Meta jamás al gateway.
- Pasos de rilascio: `docs/ops/rilascio-c3.md`.
