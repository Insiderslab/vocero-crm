-- 015 — Richieste di cancellazione dati da Meta (Data Deletion Request
-- Callback): una tabella nuova e vuota, nessuna tabella esistente toccata.
-- Come 0013–0018: il migratore di Drizzle applica tutte le migrazioni
-- pendenti in UNA transazione, quindi SET LOCAL vale fino al COMMIT; se il
-- lock non arriva in 5 s fallisce e l'avvio riprova.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "meta_data_deletion_request" (
	"id" text PRIMARY KEY NOT NULL,
	"meta_user_id" text NOT NULL,
	"confirmation_code" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"issued_at" timestamp,
	"note" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "meta_data_deletion_status_ck" CHECK ("meta_data_deletion_request"."status" in ('received', 'in_progress', 'completed')),
	CONSTRAINT "meta_data_deletion_code_ck" CHECK ("meta_data_deletion_request"."confirmation_code" ~ '^[A-Za-z0-9]{20}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "meta_data_deletion_code_uq" ON "meta_data_deletion_request" USING btree ("confirmation_code");--> statement-breakpoint
CREATE INDEX "meta_data_deletion_user_idx" ON "meta_data_deletion_request" USING btree ("meta_user_id");