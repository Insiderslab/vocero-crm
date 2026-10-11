-- 009 (E1) — Mensaje de cortesía cuando falla el proveedor de IA
-- (agent_profile.error_reply). Solo catálogo: ADD COLUMN sin default no
-- reescribe la tabla. Como 0013/0014: el migrador de Drizzle aplica todas las
-- migraciones pendientes en UNA transacción, así que SET LOCAL vale hasta el
-- COMMIT; si el lock no llega en 5 s, falla y el arranque lo reintenta, en vez
-- de encolar el tráfico detrás.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "error_reply" text;
