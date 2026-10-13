-- 007 — Acceso reservado (agent_profile). Solo catálogo: ADD COLUMN con
-- default constante no reescribe la tabla (PostgreSQL >= 11). Como 0013: el
-- migrador de Drizzle aplica todas las migraciones pendientes en UNA
-- transacción, así que SET LOCAL vale hasta el COMMIT; si el lock no llega en
-- 5 s, falla y el arranque lo reintenta, en vez de encolar el tráfico detrás.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "restrict_to_allowlist" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "allowed_identities" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "outsider_reply" text;