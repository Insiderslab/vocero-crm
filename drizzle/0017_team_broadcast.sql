-- 012 — Ronda del team (POST /api/bot/team-broadcast): una riga per ronda,
-- per idempotenza (UNIQUE organizzazione + Idempotency-Key), limite orario e
-- «ultima ronda» nella pagina Agente IA. Solo catalogo: tabella nuova e vuota
-- con i suoi indici; la FK verso `organization` prende un lock breve su quella
-- tabella. Come 0013–0016: il migratore di Drizzle applica tutte le
-- migrazioni pendenti in UNA transazione, quindi SET LOCAL vale fino al
-- COMMIT; se il lock non arriva in 5 s fallisce e l'avvio ritenta, invece di
-- mettere in coda il traffico dietro.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "team_broadcast" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"template_name" text NOT NULL,
	"language" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	CONSTRAINT "team_broadcast_status_ck" CHECK ("team_broadcast"."status" in ('running', 'done'))
);
--> statement-breakpoint
ALTER TABLE "team_broadcast" ADD CONSTRAINT "team_broadcast_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_broadcast_org_key_uq" ON "team_broadcast" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "team_broadcast_org_created_idx" ON "team_broadcast" USING btree ("organization_id","created_at");