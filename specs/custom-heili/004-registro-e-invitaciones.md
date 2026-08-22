# Fase 4b — Registro e invitaciones (modelo híbrido de acceso)

> Customización sobre el fork desplegado en crm.heili.cloud.
> **Estado: 📝 SPEC DE DISEÑO (2026-08-21, rama `notte-2026-08-21`) — NO
> implementada.** Escrita ANTES del código (constitución VI).
> **Carril declarado: LIGERO** — no toca el modelo de datos (la tabla
> `invitation` ya existe, `src/lib/db/schema.ts:90-102`) ni un contrato
> publicado. Si durante la implementación aparece una migración (p. ej. la
> aprobación manual de orgs, § Fuera de alcance), **sube a ciclo completo**
> (constitución VI, regla de subida de carril).
> Análisis completo con `file:línea`: `docs/analisi/REGISTRAZIONE-E-INVITI.md`.

**Constitution Check (carril ligero, obligatorio)**: sin email (II ✔️ — el
invito es un link copiable que entrega el humano); aislamiento por org intacto
(III ✔️ — los permisos de invitación los aplica el plugin por membresía);
secretos fuera del código (I ✔️ — el token es el id del invito, generado por
Better Auth); foco vertical intacto (VIII ✔️ — es acceso al CRM, no feature de
canal). Sin violaciones.

**Input**: decisión del owner 2026-08-21 — modelo HÍBRIDO de tres puertas:
(1) self-signup público con org propia, (2) invitación del super-admin,
(3) invitación entre usuarios de la misma organización.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Invitación entre usuarios con link copiable (Priority: P1)

El owner de una organización invita a un colaborador: entra a Impostazioni →
Team, pulsa "Invitar", escribe el correo y el rol, y obtiene un **link
copiable** que manda por WhatsApp/chat. El invitado abre el link, ve la org y
el rol, crea su cuenta (correo prellenado, fijado al del invito) o inicia
sesión, y entra como miembro.

**Why this priority**: es la puerta 3, la de uso diario; hoy el owner debe
inventar una contraseña temporal y dictarla
(`src/app/api/settings/team/route.ts:42-83`).

**Independent Test**: con dos navegadores: el owner genera el link, el
invitado lo abre, se registra y queda como miembro visible en la lista del
equipo. Valor entregado aunque no existan las puertas 1 y 2.

**Acceptance Scenarios**:

1. **Given** un owner autenticado, **When** crea una invitación con correo y
   rol, **Then** la UI muestra un link único copiable y la invitación queda
   `pending` con caducidad.
2. **Given** un link válido, **When** un visitante sin cuenta lo abre,
   **Then** ve nombre de la org y rol, y puede crear la cuenta SOLO con el
   correo del invito; al terminar queda miembro y la invitación `accepted`.
3. **Given** un link válido y un usuario ya registrado con ese correo,
   **When** inicia sesión y acepta, **Then** queda miembro (si ya tenía otra
   org, la nueva aparece en su selector).
4. **Given** un link usado, caducado o revocado, **When** se abre, **Then**
   la página dice "invitación no válida" y no crea nada.
5. **Given** un miembro (no owner/admin), **When** intenta crear una
   invitación, **Then** recibe 403 (permisos del plugin).

---

### User Story 2 — Invitación del super-admin (Priority: P2)

El super-admin, desde `/admin`, elige una organización (o la crea) e invita al
cliente con un link copiable, con rol owner o member. Nunca inventa ni
transmite contraseñas.

**Why this priority**: es la puerta 2 («devo avere questo potere»); hoy el
alta con contraseña manual ya existe, la invitación la vuelve segura y cómoda.

**Independent Test**: el super-admin genera el link para una org nueva, lo
abre en navegador limpio, el cliente se registra y queda owner; el super-admin
puede operar la org como hasta hoy.

**Acceptance Scenarios**:

1. **Given** el super-admin en `/admin`, **When** invita a un correo a una org
   existente, **Then** obtiene el link (si no era miembro de esa org, el
   sistema lo hace owner antes, de forma idempotente — patrón Fase 1).
2. **Given** el link, **When** el cliente lo usa, **Then** el flujo es el de
   la US1 y el rol asignado es el elegido por el super-admin.
3. **Given** un usuario sin `SUPERADMIN_EMAILS`, **When** llama la ruta de
   invitación admin, **Then** recibe 403 `not_superadmin`.

---

### User Story 3 — Self-signup público con org propia (Priority: P3)

Con la instancia en modo abierto, cualquier visitante se registra en
`/register` y obtiene SU organización (pipeline y perfil de agente sembrados),
sin tocar las demás.

**Why this priority**: es la puerta 1; cambia el comportamiento histórico
"registro cerrado tras la primera org" (FR-060), así que va detrás de un env
explícito y se prueba por separado.

**Independent Test**: instancia con `SIGNUP_MODE=open` y una org ya existente:
un registro nuevo crea una segunda org aislada y el usuario entra como owner;
con el modo por defecto, el registro sigue cerrado (regresión FR-060 intacta).

**Acceptance Scenarios**:

1. **Given** `SIGNUP_MODE=open`, **When** un visitante se registra, **Then**
   se crea una org nueva provisionada (mismas semillas que
   `provisionOrganization`) y el usuario es su owner.
2. **Given** el modo por defecto (sin env), **When** ya existe una org,
   **Then** el registro responde 403 como hoy.
3. **Given** modo abierto, **When** una IP supera el límite de registros,
   **Then** recibe 429 y no se crea nada.
4. **Given** modo abierto y `MAX_ORGANIZATIONS` alcanzado, **When** alguien
   se registra, **Then** recibe un error claro y no se crea la org.

---

### Edge Cases

- Invitado que intenta aceptar con un correo DISTINTO al del invito → 403 del
  plugin (`crud-invites.mjs:269`); la UI lo explica.
- Correo ya miembro de la org → error al crear la invitación (plugin,
  `crud-invites.mjs:124-129`); la UI dice "ya es miembro".
- Dos invitaciones al mismo correo: la segunda actualiza la caducidad
  (`resend`, `crud-invites.mjs:137-148`).
- Registro simultáneo en modo abierto: el advisory lock actual
  (`on-signup.ts:54`) cubre el caso "primera org"; la generalización a N orgs
  debe mantener la creación atómica por usuario.
- Link reenviado a terceros: solo funciona para quien controle el CORREO del
  invito (el match de correo es la frontera, no el secreto del link).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-101**: El sistema MUST generar invitaciones como **link copiable**
  (`{APP_BASE_URL}/invitacion/{id}`) sin enviar correo (constitución II); la
  entrega la hace el humano.
- **FR-102**: Toda invitación MUST tener caducidad (default 48 h del plugin;
  [NEEDS CLARIFICATION: owner, ¿7 días para links entregados a mano?]) y ser de
  **uso único** (`status` pending → accepted/canceled).
- **FR-103**: El super-admin MUST poder revocar invitaciones pendientes; owner
  y admin de la org MUST poder hacerlo en su org.
- **FR-104**: La aceptación MUST exigir cuenta con el MISMO correo del invito
  (garantía del plugin) y MUST funcionar tanto para usuarios nuevos (registro
  con correo fijado, vía bypass interno del gate) como existentes (login +
  aceptar).
- **FR-105**: El super-admin MUST poder invitar a una org nueva o existente
  con rol owner/member; si no es miembro de esa org, el sistema lo hace owner
  antes, de forma idempotente.
- **FR-106**: Con `SIGNUP_MODE=open`, cada registro público MUST crear una
  organización propia provisionada; sin ese env, MUST conservarse el cierre
  tras la primera org (FR-060, constitución restricciones de plataforma).
- **FR-107**: El registro público abierto MUST mantener defensas soberanas:
  rate limit por IP (existe; bucket dedicado más estricto para sign-up) y
  [NEEDS CLARIFICATION: cuota `MAX_ORGANIZATIONS`, ¿sí/no?].
- **FR-108**: Los permisos MUST seguir el plugin: owner/admin crean y
  cancelan invitaciones; member no.
- **FR-109**: Ninguna contraseña temporal MUST circular por chat: las altas por
  invitación fijan la contraseña la propia persona invitada.

### Key Entities

- **Invitación** (ya existe, `schema.ts:90-102`): id (= token del link),
  organizationId, email, role, status, expiresAt, inviterId. Sin cambios de
  schema en este carril.
- **Modo de registro** (config, no dato): `SIGNUP_MODE` (default cerrado tras
  la primera org; `open` = puerta 1) y `MAX_ORGANIZATIONS` opcional.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un owner invita a un colaborador y el colaborador queda dentro
  en < 3 minutos, sin que ninguna contraseña se transmita por chat.
- **SC-002**: El super-admin da de alta a un cliente en una org nueva con un
  solo link (cero cuentas con contraseña manual).
- **SC-003**: En modo abierto, 100% de los registros crean exactamente una org
  propia aislada (verificable: el usuario B no ve datos de la org A).
- **SC-004**: Regresión: en modo por defecto el registro sigue cerrado tras la
  primera org (self-test E2E existente sigue verde).

## Assumptions

- Better Auth 1.6.23 ya instalado cubre el ciclo de vida del invito
  (`createInvitation` devuelve el id; `sendInvitationEmail` es opcional y hoy
  no está configurado) — verificado en `node_modules/better-auth/dist/plugins/
  organization/routes/crud-invites.mjs` y `adapter.mjs`.
- El super-admin por env (`SUPERADMIN_EMAILS`) es suficiente y no se migra a
  un rol en DB (pendiente de confirmación: pregunta 1 del análisis).
- La entrega del link es responsabilidad del humano (WhatsApp, chat, en
  persona): el sistema solo lo genera y lo muestra copiable.

## Fuera de alcance (v1)

- Envío de email (PROHIBIDO, constitución II), verificación de correo,
  SSO/OAuth, aprobación manual de orgs self-registradas (requiere migración →
  ciclo completo aparte), límites de miembros por org, invitaciones con rol
  `admin` desde la puerta 3 (se evalúa en implementación; el plugin lo
  permite).
