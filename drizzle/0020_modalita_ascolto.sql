-- 016 — Modalità ascolto per organizzazione: una tabella nuova e vuota
-- (`listening_mode`, una riga per organizzazione), nessuna tabella esistente
-- toccata e nessun backfill (nessuna riga = spento).
-- Come 0013–0019: il migratore di Drizzle applica tutte le migrazioni
-- pendenti in UNA transazione, quindi SET LOCAL vale fino al COMMIT; se il
-- lock non arriva in 5 s fallisce e l'avvio riprova.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "listening_mode" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"enabled_at" timestamp,
	"enabled_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listening_mode" ADD CONSTRAINT "listening_mode_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listening_mode_org_uq" ON "listening_mode" USING btree ("organization_id");