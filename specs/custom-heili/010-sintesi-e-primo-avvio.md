# 010 — «Sintesi» (dashboard) e «Primi passi» (checklist di primo avvio)

**Carril**: ligero (`spec.md` únicamente) — sin migración, sin contrato publicado.
La rotta nueva `/api/dashboard/summary` es interna (la consume solo la UI de este
repo, con sesión de miembro); no es un DTO de los que el Principio VI llama
«contrato publicado».
**Fecha**: 2026-10-11. **Origen**: test de usabilidad de Heili CRM, interventos de
prioridad 2 (el P1 lo trabaja otro agente; los canales, otro más — estos tocan
archivos distintos).

## Constitution Check (antes de escribir código)

- **I — Datos primero**: la Sintesi y la checklist leen SOLO la organización de la
  sesión; no escriben nada; no hay secretos en la respuesta.
- **II — Soberanía**: cero dependencias nuevas; los gráficos son CSS/SVG a mano.
- **III — Multi-tenancy**: toda consulta pasa por `scoped()`; el aislamiento se
  prueba con dos organizaciones en golden.
- **IV — Idempotencia**: no aplica (nada externo entra ni sale).
- **V/IX — Calidad verificable**: typecheck + lint + build + tests; golden sobre
  PostgreSQL real con números escritos a mano; sanos y aislamiento con sabotajes.
- **VI — Specs antes de código**: este archivo, previo al código (carril ligero).
- **VII — Trazabilidad**: decisiones no cubiertas por el prompt van como preguntas
  en el PR.

## Problema

1. Heili CRM no tiene una vista de conjunto: el dueño no ve, en una pantalla, cómo
   va su operación (dónde están las conversaciones, cuánto se tarda en responder,
   cuánto responde la IA, cuántos pasan a una persona, cuántos cierran). Es la
   laguna más grande de cara al cliente.
2. Un cliente nuevo no sabe qué le falta para llegar a su primer mensaje
   (número, plantilla, agente, prueba, encendido). Un botón gris sin explicación
   («Crea regola» en Automazioni) es el mismo problema en pequeño.

## Comportamiento observable (criterios de aceptación)

### A. Sintesi — `/dashboard`

1. La voce «Sintesi» è la **prima** del menu laterale y la ve **cualquier
   miembro**; la página inicial después del login **no cambia** (sigue siendo la
   bandeja).
2. Selector de período **7 / 30 / 90 días** (por defecto 30). Cambiar de período
   recarga los datos sin pintar jamás un falso cero: mientras carga se ven
   esqueletos.
3. Bloques, para la organización de la sesión:
   - **Conversaciones por etapa del pipeline**: conteo por etapa, con el nombre
     de la etapa COMO ESTÁ GUARDADO; las etapas sin conversaciones aparecen en 0.
   - **Tiempo de primera respuesta**: mediana y percentil 90, en minutos, entre el
     primer mensaje entrante de una conversación dentro del período y su primera
     respuesta saliente. Se excluyen las conversaciones de test
     (`conversation.is_test`).
   - **IA contra persona**: salientes del período con `message.ai_generated` true
     contra false; más las conversaciones cuyo `conversation.handoff_at` cae en
     el período, divididas por `handoff_reason`.
   - **Conversiones**: leads que entran a la etapa ganada en el período, desde
     `lead_stage_event` (`to_stage_kind = 'won'`, distinto por lead).
   - **Andamento**: mensajes entrantes y salientes por día del período, como
     gráfico de barras simple.
4. Datos solo de la organización de la sesión; las conversaciones de test no
   aparecen en ningún bloque.
5. Estados vacíos claros («Aún no hay datos en este período») y estados de carga
   con esqueletos.
6. Gráficos accesibles: `aria-label` con los números, texto alternativo; legibles
   en tema claro y oscuro y a 390 px de ancho. Fechas y números con `Intl` en el
   idioma de la interfaz (es/en/it).
7. `GET /api/dashboard/summary?days=7|30|90` responde los agregados; cualquier
   miembro autenticado puede pedirla; `days` inválido → 422. La rotta está en el
   inventario de roles.

### B. Primi passi (checklist de primer avvio)

1. Componente visible **en la cima de Sintesi y de Automazioni** para owner/admin
   mientras quede algún paso pendiente; cuando todo está completo se oculta.
2. Cinco pasos, cada uno con estado hecho/pendiente y link al lugar correcto:
   1. Número de WhatsApp conectado (conexión activa de la organización:
      `meta_credentials.status = 'connected'` y `app_disconnected_at` nulo).
   2. Al menos una plantilla Meta **aprobada**.
   3. Agente configurado: instrucciones no vacías y al menos una entrada de la
      base de conocimiento.
   4. Al menos una evaluación ejecutada en el Laboratorio (`agent_test_run`
      terminada: `status = 'done'`).
   5. Agente encendido.
3. El estado de los pasos sale de UNA función servidor
   (`src/server/onboarding/checklist.ts`), con sus tests.
4. Se puede **reabrir desde Impostazioni**: un link («Ver de nuevo los primeros
   pasos») lleva a `/dashboard?primi-passi=1`, que fuerza la checklist aunque
   esté completa. no se persiste estado nuevo (sin cookie, sin BD).
5. En Automazioni, cuando «Crea regola» está deshabilitado, dice **qué falta**:
   los pasos 1–2 con el mismo cálculo de la checklist, más los campos del
   formulario que falten. Nunca un gris mudo.

## Qué se decide NO hacer (y por qué)

- **Sin librerías de gráficos ni dependencias nuevas** (constitución II):
  barras CSS a mano.
- **Sin migraciones**: todo se calcula de los datos existentes. Índices nuevos
  solo se anotan como candidatos en el registro (no se crean).
- **Sin cambios al landing post-login** (lo pide el prompt explícitamente).
- **Sin persistir la checklist ni su «reabrir»**: el reabrir es un parámetro de
  query; nada que migrar ni limpiar.
- **Sin datos reales**: los tests construyen datos sintéticos.
