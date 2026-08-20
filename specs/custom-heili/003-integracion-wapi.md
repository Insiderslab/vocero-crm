# Fase 4 — Integración Wapi (canal WhatsApp vía gateway propio)

> Decisión de arquitectura (2026-08-20): el CRM se conectará a WhatsApp a
> través de **Wapi**, el gateway propio del ecosistema Heili (`wapi-app`,
> desplegado en el mismo VPS, código en `/opt/wapi`), en vez de hablar
> directamente con la Meta Cloud API. Estado: **borrador, no implementado**.

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

## Alcance propuesto (v1)

1. **Wapi primero**: exponer lo que el CRM necesita — entrantes reenviados al
   webhook del CRM (o cola/pull), envío de texto + plantilla + media, estados
   de entrega, estado de plantillas. Auth entre servicios: `X-API-Key` (mismo
   patrón que `/api/bot/*` y `/api/export/*`).
2. **Adaptador en el CRM**: cliente único (espejo de `src/lib/meta/`) que
   apunte a Wapi — p. ej. `WAPI_BASE_URL` + `WAPI_API_KEY`. Mientras
   `WAPI_BASE_URL` no exista, el CRM sigue hablando con Meta directo
   (coexistencia: migración por org, no big-bang).
3. **Sin tocar la constitución**: Wapi es infraestructura propia self-hosted
   en el mismo VPS (no es un servicio externo tipo S3/Stripe); la soberanía
   (II) se mantiene — Meta sigue siendo la única dependencia real, detrás de
   Wapi.
4. **Mock**: el adaptador debe respetar el mismo gate de `wa-mock` para que el
   self-test E2E siga corriendo sin tocar nada real.

## Fuera de alcance (v1)

Instagram/Facebook, cambios de UI, migración de credenciales cifradas ya
guardadas en el CRM (se decide al diseñar el adaptador: ¿se mueven a Wapi o
Wapi las recibe por llamada?).

## Preguntas abiertas

- ¿Push (Wapi → webhook del CRM) o pull (CRM → Wapi)? Push es más simple y
  ya hay patrón de webhook en el CRM.
- ¿Wapi firma los reenvíos (HMAC tipo `META_APP_SECRET`)?
- ¿Multi-tenancy: una instancia Wapi para todas las orgs del CRM, con
  `phoneNumberId` como llave de enrutado?
- ¿Quién persiste la ventana de 24 h? Hoy la calcula el CRM; conviene que
  siga así (Wapi = tubo, CRM = cerebro).
