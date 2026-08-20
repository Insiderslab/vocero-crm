# Fases 2 y 3 — Tags, Extracción y Automatizaciones (custom heili.cloud)

> Sobre el fork de crm.heili.cloud. Requiere Fase 1 (multi-org).
> **Estado: ✅ implementadas y desplegadas (2026-08-20, commit `38bdc65`).**
> Verificación: `scripts/e2e-custom-heili.mjs` (40/40).

## Fase 2 — Tags + API de extracción

### Tags en contactos

- Tablas `tag` (org, nombre único por org, color opcional) y `contact_tag`
  (N:M, cascada con contacto y con tag). Ambas con `organization_id` NOT NULL
  e índices org-first (constitución III).
- API interna (sesión, org activa):
  - `GET /api/tags` — tags de la org con # de contactos.
  - `POST /api/tags` — crear (nombre repetido devuelve el existente: la UI
    crea al vuelo sin 409).
  - `DELETE /api/tags/[id]` — borra el tag y sus asignaciones.
  - `PUT /api/contacts/[id]/tags` — reemplazo total `{tagIds: []}`.
  - `GET /api/contacts` — incluye `tags` por contacto y filtro `?tag=<id>`.
- UI Contactos: chips de tag por contacto, editor por contacto (crear al
  vuelo) y filtro por tag.

### API de extracción (para IA / n8n)

- Auth: `X-API-Key` contra `EXPORT_API_KEY` (env, comparación en tiempo
  constante). Sin la variable → 401 en toda la superficie. Es una llave del
  OPERADOR de la instancia: puede extraer cualquier org.
- `?org=<id|slug>` obligatorio (multi-org). `?format=json|csv` (json default).
- Endpoints: `contacts`, `conversations`, `messages` (con `?conversation=` y
  `?since=`), `leads`. Todo org-scoped y solo lectura.

## Fase 3 — Automatizaciones (WhatsApp)

- Regla: *a contactos con tag T, cada N días, enviar plantilla aprobada P*.
  Tablas `automation_rule` y `automation_run` (bitácora de envíos).
- Motor in-process (constitución II: sin colas externas):
  - tick cada `AUTOMATIONS_TICK_MS` (default 30 min) desde `instrumentation`.
  - Elegible: contacto con el tag, no archivado, con teléfono, cuyo último
    envío exitoso de ESA regla es más viejo que N días (o no existe).
  - Se salta (sin gastar plantilla) si la ventana de 24 h está abierta.
  - Plantillas con 1 variable: `{{1}}` = nombre del contacto. Con más de una
    variable la regla no se puede crear (v1).
  - Org sin WhatsApp conectado: se salta entera, sin ruido en la bitácora.
  - Máx. 50 envíos por regla por tick; 150 ms entre envíos.
- API interna: `GET/POST /api/automations`, `PATCH/DELETE
  /api/automations/[id]`, `GET /api/automations/[id]/runs`,
  `POST /api/automations/run` (ejecutar ahora, solo la org activa).
- UI: página `/automations` (nav "Automatizaciones"): crear regla, activar/
  pausar, borrar, bitácora reciente, ejecutar ahora.

## Cumplimiento Meta

Las automatizaciones SOLO envían plantillas aprobadas (regla de Meta fuera de
la ventana de 24 h). Sin broadcast masivo: el límite por tick y la cadencia por
contacto están cableados en el motor.
