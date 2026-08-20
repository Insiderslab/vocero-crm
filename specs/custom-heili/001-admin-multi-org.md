# Fase 1 — Panel Admin multi-empresa (custom heili.cloud)

> Customización sobre el fork desplegado en crm.heili.cloud. No existe upstream.
> **Estado: ✅ implementada y desplegada (2026-08-20, commit `38bdc65`).**
> Verificación: `scripts/e2e-custom-heili.mjs` (40/40).

## Objetivo

Una instancia, N empresas (organizaciones): el operador de la instancia
(super-admin) crea organizaciones para sus empresas y las de sus clientes,
crea usuarios dentro de cada una y entra a operar cualquiera. Los datos
siguen aislados por `organization_id` (constitución III — ya cumplida por el
schema).

## Decisiones

- **Super-admin por entorno**: `SUPERADMIN_EMAILS=correo1,correo2`. Es una
  capacidad de la instancia, no un rol de organización. Sin la variable, no
  hay super-admin y `/api/admin/*` responde 403.
- **Sin cambio de schema**: `member` ya soporta N membresías por usuario y
  `session.active_organization_id` ya existe. El super-admin se hace
  miembro `owner` de cada org que crea.
- **Org activa**: `requireSession()` respeta `session.activeOrganizationId`
  cuando el usuario es miembro de esa org; si no, cae a la primera membresía
  (comportamiento anterior). El cambio de org usa el endpoint nativo de
  Better Auth `organization/set-active`, que valida membresía.
- **Provisioning**: crear org siembra las mismas etapas de pipeline y el
  perfil de agente que el primer registro (lógica extraída de `on-signup`).

## Superficie

| Pieza | Detalle |
|---|---|
| `GET /api/admin/orgs` | Lista orgs + # miembros + # contactos (super-admin) |
| `POST /api/admin/orgs` | Crea org; opcional: crea también la cuenta del primer usuario del cliente |
| `GET /api/admin/orgs/[id]/users` | Miembros de la org |
| `POST /api/admin/orgs/[id]/users` | Crea usuario dentro de la org (bypass interno del registro cerrado) |
| `GET /api/my-orgs` | Orgs del usuario autenticado (para el switcher) |
| `/admin` | Página del panel (solo super-admin; el resto → /inbox) |
| AppNav | Entrada "Admin" (solo super-admin) + selector de empresa si el usuario tiene >1 |

## Errores

- 403 `not_superadmin` — cualquier `/api/admin/*` sin estar en `SUPERADMIN_EMAILS`.
- 409 `duplicate` — correo ya registrado al crear usuario.
- 422 `invalid_body` — validación Zod.

## Fuera de alcance (fases siguientes)

Borrado/suspensión de orgs, tags, API de extracción (Fase 2), automatizaciones
(Fase 3).
