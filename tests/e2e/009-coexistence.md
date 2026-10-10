# E2E 009 — Coexistence (app WhatsApp Business + CRM)

Guion de comportamiento. La parte automatizada vive en la sección "009" de
`scripts/e2e-selftest.mjs` (app con `WA_MOCK_ENABLED=true`, BD fresca y
`META_APP_ID` + `META_ES_CONFIG_ID` + `META_APP_SECRET` definidos; sin ellos la
sección se salta). Spec: `specs/custom-heili/006-coexistence-embedded-signup.md`.

| AC | Check del selftest |
|---|---|
| US1 AC-2 token nunca al navegador | "config pública sin App Secret" + "conexión guardada en modo coexistence, token solo …last4" |
| US1 AC-3 número deducido de la WABA | "Embedded Signup completo (code canjeado, número deducido de la WABA)" |
| US1 AC-4 code vencido | "code inválido → 422 code_exchange_failed" + "la conexión anterior sigue intacta tras el fallo" |
| US1 AC-7 sync pedida en orden | "agenda e historial pedidos a Meta" + "smb_app_data: primero agenda, luego historial" |
| Input inválido | "WABA ID inválido → 422" |
| US2 AC-1 dirección | "dirección correcta: entrante del cliente, saliente manual del dueño" |
| US2 AC-2 sin efectos de mensaje nuevo | "historial NO abre la ventana de 24 h ni suma no-leídos" + "historial NO crea leads en el pipeline" |
| US2 AC-3 idempotencia | "bloque de historial repetido no duplica" |
| US2 AC-4 historial no compartido | "historial rechazado por el negocio → webhook 200" |
| US2 AC-6 orden del hilo | "el hilo se ordena por el último mensaje del historial" |
| US3 AC-1 agenda no crea contactos | "la agenda NO crea conversaciones" |
| US3 AC-2 nombre desde la agenda | "historial crea el hilo de Giulia con el nombre de la agenda" |
| US3 AC-3 relleno vs. nombre puesto | "agenda renombra el contacto con nombre de relleno" + "agenda respeta un nombre ya puesto" |
| US4 AC-1/2/3 corte y reconexión | "ACCOUNT_OFFBOARDED marca…", "ACCOUNT_RECONNECTED la restablece", "otros eventos… no cambian nada" |

## Manual (en vivo, con Meta real)
1. Configuración → WhatsApp → "Conectar con Meta" → login Facebook → elegir
   el número de la app → confirmar en el teléfono (QR/aviso) → compartir
   historial: sí.
2. Esperado: "Número … conectado (app + CRM)", tarjeta con "App + CRM".
3. Log: `[webhook] … agenda de la app — N cambios` y
   `historial de la app importado — N mensajes nuevos`.
4. Escribir desde otro teléfono al número → entra al inbox; contestar desde la
   app del teléfono → aparece como manual y la IA se pausa.
