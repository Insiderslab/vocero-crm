-- 008 (custom heili) — Richieste dal sito web nella posta.
--
-- Generata con `drizzle-kit generate` e completata a mano (come 0013).
-- Numero 0016: rigenerata dopo il merge delle PR #8 (0014) e #12 (0015,
-- `0015_agent_error_reply`); lo snapshot discende da quello della 0015.
--
-- Drizzle applica tutte le migrazioni pendenti in UNA transazione: qui solo
-- istruzioni di catalogo, senza scansioni né riscritture:
--   * tabella nuova (vuota) `site_request_config` con il suo indice;
--   * `contact.email` (colonna nullable senza default: solo catalogo);
--   * `message_channel_ck` sostituito dalla versione con 'web', NOT VALID.
--     Lo valida il runner (fase B di `scripts/migrate-channels.mjs`, passo
--     `VALIDATE CONSTRAINT "message_channel_ck"`, già presente per nome),
--     fuori transazione, come in 0013. Le righe esistenti sono tutte
--     'whatsapp': la validazione non può fallire.
-- Nessun backfill. V1–V7 non dipendono da niente di questo.

SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "site_request_config" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"allowed_origins" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_request_config" ADD CONSTRAINT "site_request_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_request_config_org_uq" ON "site_request_config" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "message" DROP CONSTRAINT "message_channel_ck";--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_channel_ck" CHECK ("message"."channel" in ('whatsapp', 'instagram', 'messenger', 'email', 'web')) NOT VALID;
