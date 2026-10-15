# E2E 013 — Collegamento WhatsApp guidato

Guion de comportamiento. Spec: `specs/custom-heili/013-collegamento-whatsapp-guidato.md`.
Automatizado en dos guiones, contra la app viva con `WA_MOCK_ENABLED=true`,
`META_APP_SECRET` sintético, `SUPERADMIN_EMAILS` = operador E2E y **sin**
`META_APP_ID` / `META_ES_CONFIG_ID` en el entorno:

- API: sección «013» de `scripts/e2e-selftest.mjs` (deja los ID guardados para
  que la sección «009» corra con ellos).
- Navegador: `scripts/e2e-whatsapp-guidato.mjs` (Playwright; schermate en
  `docs/lavoro/img/013/`). `PW_CHROMIUM=<ruta>` si el Chromium instalado no es
  el de la versión de Playwright.

| AC | Check |
|---|---|
| A1 solo super-admin | selftest «GET Piattaforma → Meta como super-admin → 200», «sin sesión → 401»; golden: member/admin/owner → 403 |
| A2 validación | selftest «ID no válidos → 422», «un appSecret en el cuerpo → 422»; navegador «5 cifre → messaggio di errore e Salva disabilitato» |
| A3 fuente visible / el entorno gana | selftest «fuente: el entorno gana si está definido, si no «db»»; navegador «fonte «salvato qui» per entrambi» |
| A4 App Secret solo presencia | selftest «el App Secret solo como presencia», «sin secretos…»; navegador «il segreto non è nella pagina» |
| A6 checklist Meta | navegador «checklist con featureType e i 6 campi» |
| A7 lo usa el Embedded Signup | selftest «el botón «Conectar con Meta» aparece en la organización con esos ID» + toda la sección 009 |
| B1 franja de estado | selftest «estado de la guía: número conectado, modo y firma»; navegador «striscia: modalità App + CRM» |
| B2 estados | navegador 1) non configurata · 2) pronta · 3) collegata · 4) da ricollegare · 5) coexistence tagliata |
| B3 paso 3 en vivo | selftest «el último entrante avanza…»; navegador ««Ultimo messaggio ricevuto» compare in diretta, senza ricaricare» |
| B4 «Avanzate» cerrada, todo dentro | navegador ««Avanzate» chiusa per default», «il link apre «Avanzate» con WABA e token», webhook y Wapi |
| Responsive | navegador «a 390 px senza scorrimento orizzontale» (/admin y la guía) |

## Manual (en vivo, con Meta real)
1. `/admin` → Piattaforma → Meta: pegar App ID y Configuration ID reales → Salva →
   «Pronto». Si el VPS aún tiene `META_APP_ID`, la etiqueta dice «dall'ambiente».
2. En una empresa: Impostazioni → WhatsApp → «Collega con Meta» → login Facebook →
   elegir el número → confirmar en el teléfono → «Condividi la cronologia».
3. Escribir desde otro teléfono: «Ultimo messaggio ricevuto: … fa» sin recargar, y
   «Firma del webhook: Verificata …» en la franja.
