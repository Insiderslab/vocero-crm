-- 013 — Collegamento WhatsApp guidato: impostazioni della piattaforma
-- (App ID e Configuration ID dell'Embedded Signup di Meta, NON segreti),
-- scritte dal super-admin in /admin → Piattaforma → Meta. Le variabili
-- d'ambiente META_APP_ID / META_ES_CONFIG_ID restano override; l'App Secret
-- resta solo nell'ambiente (il CHECK sulle chiavi impedisce di salvarlo qui).
--
-- Solo catalogo: una tabella nuova e vuota, nessuna tabella esistente toccata.
-- Come 0013–0015: il migratore di Drizzle applica tutte le migrazioni pendenti
-- in UNA transazione, quindi SET LOCAL vale fino al COMMIT; se il lock non
-- arriva in 5 s fallisce e l'avvio riprova, invece di accodare il traffico.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "instance_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instance_setting_key_ck" CHECK ("instance_setting"."key" in ('meta_app_id', 'meta_es_config_id')),
	CONSTRAINT "instance_setting_value_ck" CHECK ("instance_setting"."value" ~ '^[0-9]{6,25}$')
);
