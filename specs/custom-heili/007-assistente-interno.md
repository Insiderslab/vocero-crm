# Fase 7 — Asistente interno del equipo en WhatsApp

> Customización sobre el fork desplegado en crm.heili.cloud.
> **Estado: ✅ IMPLEMENTADA** (2026-10-10), rama local `team-assistant`
> (base `origin/main` @ `83c6a13`, con la doble escritura de 005 R1).
> **Carril: COMPLETO** — migración nueva `drizzle/0014_*.sql` (3 columnas en
> `agent_profile`). Registro: `docs/lavoro/2026-10-10-assistente-interno.md`.

**Constitution Check**: sin dependencias nuevas (II ✔️); sin secretos nuevos
(I ✔️ — la lista de números no es un secreto, pero solo la leen owner/admin);
multi-tenancy (III ✔️ — renombrar es super-admin con la organización en la
ruta; borrar la demo y la lista de acceso van SIEMPRE por la organización de
la sesión; se corrige además un borrado sin `organization_id` en el seed demo);
idempotencia (IV ✔️ — la respuesta a externos se envía una vez por
conversación; borrar la demo dos veces no hace nada la segunda);
doble escritura 005 (✔️ — borrar contactos borra también su `contact_identity`
en la misma transacción: V3 queda en 0).

**Input**: pedido del owner 2026-10-10 — convertir una organización en un
asistente interno del equipo por WhatsApp: el número responde solo a los
miembros del equipo, los demás reciben (como mucho) un aviso fijo.

## Historias

### US1 — Renombrar una organización (super-admin) (P1)
En `/admin`, cada organización tiene "Renombrar": campo de texto y guardar.

**AC**
1. `PATCH /api/admin/orgs/[orgId]` `{ name }` con `withSuperadmin`: 401 sin
   sesión, 403 `not_superadmin` a cualquier otro (también al owner de esa
   organización).
2. `name` con Zod: recortado, 1–80 caracteres; vacío o > 80 → 422.
3. Organización inexistente → 404. El `slug` NO cambia (enlaces estables).
4. La ruta figura en el inventario de roles (`tests/unit/helpers/route-roles.ts`).

### US2 — Quitar los datos demo (P1)
Junto al botón "Cargar demo" de la bandeja existe "Quitar datos demo"; como
la demo solo se carga con la bandeja vacía, la bandeja muestra el botón
también cuando la organización TIENE datos demo (`GET /api/seed/demo` →
`{ hasDemo }`).

**AC**
1. `DELETE /api/seed/demo` con `withAdminAuth` (owner/admin; 403 al resto).
2. Borra, SOLO en la organización de la sesión: los contactos cuyo
   `wa_identity` o `phone` está en `DEMO_CONTACTS`, sus conversaciones,
   mensajes, leads (y lo que cuelga en cascada) y su `contact_identity`, más
   las entradas de KB que coinciden EXACTAMENTE (tipo + textos) con `DEMO_KB`.
3. No toca: contactos reales, KB editado o propio, perfil del agente, corridas
   del Laboratorio, otras organizaciones.
4. Todo en una transacción; respuesta `{ ok, contacts, kbEntries }` con lo
   borrado. Repetirlo → `{ contacts: 0, kbEntries: 0 }`.
5. Tras el borrado `channels_legacy_check()` sigue con V3 = 0.
6. **Bug corregido**: la limpieza de `seedDemo` buscaba los contactos demo
   por teléfono SIN `organization_id` → recargar la demo en A borraba la demo
   de B. Ahora va por organización (test negativo).

### US3 — Acceso reservado (P1)
En Agente IA → "Acceso reservado": interruptor, lista de números (uno por
línea) y respuesta para externos.

**AC**
1. Columnas nuevas en `agent_profile`: `restrict_to_allowlist boolean not
   null default false`, `allowed_identities text[] not null default '{}'`,
   `outsider_reply text`. Apagado por defecto → comportamiento idéntico al de
   hoy (golden sin cambios).
2. Normalización (una sola función, `src/server/ai/allowlist.ts`): se quitan
   espacios, `+`, `-`, `.`, `()` y un `00` inicial; debe quedar solo dígitos,
   8–15; luego `normalizeMx` (521→52). Líneas vacías se ignoran; duplicados
   (también tras normalizar) se quitan; una línea inválida → 422 con la línea.
   Máximo 500 números.
3. En `runAgentTurn`, tras comprobar perfil/handoff/IA de la conversación y
   ANTES de leer historial, KB o llamar al modelo: si la restricción está
   activa y la `wa_identity` del contacto (normalizada igual) no está en la
   lista → no se llama a la IA, no se lee el KB, no hay handoff. Las
   identidades `bsuid:` nunca coinciden (fail-closed).
4. Si `outsider_reply` tiene texto, se envía UNA vez por conversación por el
   camino normal (`sendText`: ventana 24 h, sandbox, credenciales). Si ya
   existe un saliente con ese texto exacto en la conversación, no se reenvía.
   Si el envío falla (ventana, sin conexión), se registra y no se reintenta en
   ese turno.
5. Números de la lista → agente normal.
6. El Laboratorio (`is_test`) NO aplica la restricción: evalúa el
   comportamiento configurado, como ya hace con el interruptor global.
7. API: `GET /api/agent/profile` devuelve `restriction` solo a owner/admin;
   `PUT` acepta `restrictToAllowlist`, `allowedIdentities` (texto o lista),
   `outsiderReply` (≤ 1000, vacío → null).

## Fuera de alcance
- El cerebro externo (`/api/bot/*`) no aplica la lista: quien lo conecta
  decide a quién responde. Se anota en el registro.
- Plantillas fuera de la ventana para la respuesta a externos.

## Pruebas
- Unit: normalización y validación de la lista, decisión pura (`isAllowed`).
- Golden (PostgreSQL real, archivo nuevo con aserciones explícitas): externo,
  permitido, idempotencia, BSUID, apagado; seed demo por organización;
  borrado de la demo con V3 = 0.
- E2E (`scripts/e2e-selftest.mjs`, sección "007"): externo / permitido,
  borrado de la demo por organización, renombrar super-admin y 403.
- Sabotajes: guardia de la lista, ámbito de organización del seed, guardia
  super-admin.
