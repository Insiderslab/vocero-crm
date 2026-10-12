-- 009 (E1) — Proveedor de IA caído: mensaje de cortesía
-- (agent_profile.error_reply) y segundo intento PERSISTIDO
-- (conversation.agent_retry_at, sobrevive a un reinicio). Solo catálogo:
-- ADD COLUMN sin default no reescribe la tabla. Como 0013/0014: el migrador de
-- Drizzle aplica todas las migraciones pendientes en UNA transacción, así que
-- SET LOCAL vale hasta el COMMIT; si el lock no llega en 5 s, falla y el
-- arranque lo reintenta, en vez de encolar el tráfico detrás.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "error_reply" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "agent_retry_at" timestamp;
