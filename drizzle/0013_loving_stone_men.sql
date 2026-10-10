-- 005-livello-canali, M1.2 — R1 «espandi», FASE A (ADR 0001 §3.3).
--
-- Generata con `drizzle-kit generate` e completata a mano (come 0001_old_sabra).
-- Drizzle applica TUTTE le migrazioni pendenti in UNA transazione: ogni lock
-- preso qui resta fino al COMMIT. Per questo questo file contiene SOLO
-- istruzioni di catalogo, senza scansioni né riscritture:
--   * tabelle nuove (vuote) con i loro indici e vincoli;
--   * colonne nuove di `conversation` e `message` (default costante: niente
--     riscrittura su PostgreSQL >= 11);
--   * FK di `conversation` e CHECK di `message` creati NOT VALID;
--   * le funzioni `channels_legacy_*` (riconciliazione e verifiche V1–V6).
--
-- NON sono qui, anche se `schema.ts` (e quindi lo snapshot di Drizzle) li
-- dichiara: li crea o li valida il runner, fuori transazione, in
-- `scripts/migrate-channels.mjs` (fase B), con `lock_timeout` e CONCURRENTLY:
--   * CREATE UNIQUE INDEX CONCURRENTLY "contact_org_id_uq";
--   * FK "contact_identity_contact_fk" (richiede "contact_org_id_uq");
--   * CREATE UNIQUE INDEX CONCURRENTLY "message_org_channel_ext_uq";
--   * VALIDATE CONSTRAINT "message_channel_ck" e "conversation_channel_account_fk".
-- Nessun backfill qui: lo fa la riconciliazione all'avvio (fase C).
-- `wapi_credentials` non si tocca (FR-015).

SET LOCAL lock_timeout = '5s';--> statement-breakpoint

CREATE TABLE "channel_account" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text NOT NULL,
	"external_account_id" text NOT NULL,
	"external_parent_id" text,
	"display_name" text,
	"verified_name" text,
	"secret_cipher" text,
	"secret_iv" text,
	"secret_tag" text,
	"secret_expires_at" timestamp,
	"status" text DEFAULT 'connected' NOT NULL,
	"config" jsonb,
	"legacy_meta_credentials_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_account_legacy_meta_credentials_id_unique" UNIQUE("legacy_meta_credentials_id"),
	CONSTRAINT "channel_account_channel_ck" CHECK ("channel_account"."channel" in ('whatsapp', 'instagram', 'messenger', 'email')),
	CONSTRAINT "channel_account_status_ck" CHECK ("channel_account"."status" in ('connected', 'reconnect_required', 'expiring', 'disconnected')),
	CONSTRAINT "channel_account_secret_ck" CHECK (("channel_account"."secret_cipher" is null) = ("channel_account"."secret_iv" is null) and ("channel_account"."secret_iv" is null) = ("channel_account"."secret_tag" is null))
);
--> statement-breakpoint
CREATE TABLE "contact_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"channel_account_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contact_identity_channel_ck" CHECK ("contact_identity"."channel" in ('whatsapp', 'instagram', 'messenger', 'email'))
);
--> statement-breakpoint
ALTER TABLE "channel_account" ADD CONSTRAINT "channel_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identity" ADD CONSTRAINT "contact_identity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Indici delle tabelle nuove (vuote): qui, non CONCURRENTLY. Prima delle FK
-- composte, che hanno bisogno di "channel_account_org_id_uq" come destinazione.
CREATE UNIQUE INDEX "channel_account_channel_ext_uq" ON "channel_account" USING btree ("channel","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_account_org_channel_uq" ON "channel_account" USING btree ("organization_id","channel");--> statement-breakpoint
CREATE INDEX "channel_account_channel_parent_idx" ON "channel_account" USING btree ("channel","external_parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_account_org_id_uq" ON "channel_account" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identity_org_channel_ext_uq" ON "contact_identity" USING btree ("organization_id","channel","external_id");--> statement-breakpoint
CREATE INDEX "contact_identity_org_contact_idx" ON "contact_identity" USING btree ("organization_id","contact_id");--> statement-breakpoint
ALTER TABLE "contact_identity" ADD CONSTRAINT "contact_identity_channel_account_fk" FOREIGN KEY ("organization_id","channel_account_id") REFERENCES "public"."channel_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Tabelle esistenti: solo catalogo. ACCESS EXCLUSIVE per il tempo del
-- catalogo, nessuna scansione (FK e CHECK NOT VALID; il runner li valida).
ALTER TABLE "conversation" ADD COLUMN "channel_account_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_channel_account_fk" FOREIGN KEY ("organization_id","channel_account_id") REFERENCES "public"."channel_account"("organization_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "channel" text DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "external_message_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_channel_ck" CHECK ("message"."channel" in ('whatsapp', 'instagram', 'messenger', 'email')) NOT VALID;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Riconciliazione e verifiche (ADR 0001 §3.3). Fino a R3 la fonte di verità
-- sono le colonne vecchie (meta_credentials, contact.wa_identity,
-- message.wa_message_id): tutte le immagini le scrivono. Si tolgono in R3.
-- ---------------------------------------------------------------------------

-- Campi 009 (coexistence) di meta_credentials in channel_account.config.
-- UNICA fonte del formato: la usano la riconciliazione, la doppia scrittura
-- (via channels_legacy_sync_accounts) e V2.
CREATE OR REPLACE FUNCTION channels_legacy_wa_config(onboarding_mode text, app_disconnected_at timestamp)
RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('onboardingMode', onboarding_mode, 'appDisconnectedAt', app_disconnected_at)
$fn$;--> statement-breakpoint

-- Account WhatsApp da meta_credentials. `only_ids` NULL = tutti (avvio);
-- altrimenti solo quelle righe (doppia scrittura, stessa transazione).
CREATE OR REPLACE FUNCTION channels_legacy_sync_accounts(only_ids text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  -- (1a) Libera i numeri cambiati: tollera lo scambio di numeri tra due
  --      organizzazioni, che un solo UPDATE farebbe fallire sull'indice
  --      UNIQUE (channel, external_account_id).
  UPDATE channel_account ca SET external_account_id = 'resync:' || ca.id
    FROM meta_credentials mc
   WHERE ca.legacy_meta_credentials_id = mc.id
     AND (only_ids IS NULL OR mc.id = ANY (only_ids))
     AND ca.external_account_id IS DISTINCT FROM mc.phone_number_id;
  -- (1b) Riallinea TUTTI i campi copiati (gli aggiornamenti del codice vecchio).
  UPDATE channel_account ca SET
      external_account_id = mc.phone_number_id, external_parent_id = mc.waba_id,
      display_name = mc.display_phone_number, verified_name = mc.verified_name,
      secret_cipher = mc.token_cipher, secret_iv = mc.token_iv, secret_tag = mc.token_tag,
      status = mc.status,
      config = channels_legacy_wa_config(mc.onboarding_mode, mc.app_disconnected_at),
      updated_at = greatest(ca.updated_at, mc.updated_at)
    FROM meta_credentials mc
   WHERE ca.legacy_meta_credentials_id = mc.id
     AND (only_ids IS NULL OR mc.id = ANY (only_ids))
     AND (ca.external_account_id, ca.external_parent_id, ca.display_name, ca.verified_name,
          ca.secret_cipher, ca.secret_iv, ca.secret_tag, ca.status, ca.config)
         IS DISTINCT FROM
         (mc.phone_number_id, mc.waba_id, mc.display_phone_number, mc.verified_name,
          mc.token_cipher, mc.token_iv, mc.token_tag, mc.status,
          channels_legacy_wa_config(mc.onboarding_mode, mc.app_disconnected_at));
  -- (1c) Inserisce gli account nuovi. Stesso cifrato (stessa ENCRYPTION_KEY,
  --      stesso formato), nessuna decifratura in SQL. ID deterministico.
  INSERT INTO channel_account (id, organization_id, channel, external_account_id, external_parent_id,
      display_name, verified_name, secret_cipher, secret_iv, secret_tag, status, config,
      legacy_meta_credentials_id, created_at, updated_at)
  SELECT 'cha_' || substr(md5(mc.id), 1, 20), mc.organization_id, 'whatsapp', mc.phone_number_id, mc.waba_id,
         mc.display_phone_number, mc.verified_name, mc.token_cipher, mc.token_iv, mc.token_tag, mc.status,
         channels_legacy_wa_config(mc.onboarding_mode, mc.app_disconnected_at),
         mc.id, mc.created_at, mc.updated_at
    FROM meta_credentials mc
   WHERE (only_ids IS NULL OR mc.id = ANY (only_ids))
  ON CONFLICT (legacy_meta_credentials_id) DO NOTHING;
  -- (3) Conversazioni reali senza account: SOLO account della STESSA organizzazione.
  UPDATE conversation cv SET channel_account_id = ca.id
    FROM channel_account ca
   WHERE ca.organization_id = cv.organization_id AND ca.channel = 'whatsapp'
     AND (only_ids IS NULL OR ca.legacy_meta_credentials_id = ANY (only_ids))
     AND cv.is_test = false AND cv.channel_account_id IS NULL;
END $fn$;--> statement-breakpoint

-- Riconciliazione completa (avvio). Idempotente.
CREATE OR REPLACE FUNCTION channels_legacy_sync() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  -- (1) account e (3) conversazioni.
  PERFORM channels_legacy_sync_accounts(NULL);
  -- (2) Identità WhatsApp mancanti: una per contatto, external_id = wa_identity
  --     (1:1, nessun alias, D5). NOT EXISTS evita di ritentare a ogni avvio
  --     l'inserimento di tutti i contatti; ON CONFLICT resta la rete.
  INSERT INTO contact_identity (id, organization_id, contact_id, channel, external_id, created_at)
  SELECT 'ci_' || substr(md5(c.id), 1, 20), c.organization_id, c.id, 'whatsapp', c.wa_identity, c.created_at
    FROM contact c
   WHERE c.wa_identity IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM contact_identity ci
                      WHERE ci.organization_id = c.organization_id
                        AND ci.contact_id = c.id AND ci.channel = 'whatsapp')
  ON CONFLICT DO NOTHING;
END $fn$;--> statement-breakpoint

-- (4) Messaggi, a lotti per chiave primaria: il runner la chiama in
--     autocommit finché restituisce NULL (un lotto = una transazione breve).
CREATE OR REPLACE FUNCTION channels_legacy_sync_messages(after_id text, batch int) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE last_id text;
BEGIN
  SELECT max(id) INTO last_id
    FROM (SELECT id FROM message WHERE id > coalesce(after_id, '') ORDER BY id LIMIT batch) s;
  IF last_id IS NULL THEN RETURN NULL; END IF;
  UPDATE message SET external_message_id = wa_message_id
   WHERE id > coalesce(after_id, '') AND id <= last_id
     AND wa_message_id IS NOT NULL AND external_message_id IS DISTINCT FROM wa_message_id;
  RETURN last_id;
END $fn$;--> statement-breakpoint

-- Verifiche V1–V6 (ADR 0001 §3.3; V7 la fa il runner). Restituisce
-- (verifica, anomalie): solo conteggi, mai valori. `jit = off`: con 100 000
-- messaggi il JIT costava ~1 s a chiamata su ~0,4 s (misura nel registro M1.2).
CREATE OR REPLACE FUNCTION channels_legacy_check() RETURNS TABLE (verifica text, anomalie bigint)
LANGUAGE sql STABLE SET jit = off AS $fn$
  -- V1: ogni meta_credentials ha il suo account, e nessun account punta a una riga sparita.
  SELECT 'V1'::text,
         (SELECT count(*) FROM meta_credentials mc
           WHERE NOT EXISTS (SELECT 1 FROM channel_account ca WHERE ca.legacy_meta_credentials_id = mc.id))
       + (SELECT count(*) FROM channel_account ca
           WHERE ca.legacy_meta_credentials_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM meta_credentials mc WHERE mc.id = ca.legacy_meta_credentials_id))
  UNION ALL
  -- V2: account uguali campo per campo (compresi i campi 009 in config).
  SELECT 'V2',
         (SELECT count(*) FROM channel_account ca
            JOIN meta_credentials mc ON mc.id = ca.legacy_meta_credentials_id
           WHERE (ca.organization_id, ca.channel, ca.external_account_id, ca.external_parent_id,
                  ca.display_name, ca.verified_name, ca.secret_cipher, ca.secret_iv, ca.secret_tag,
                  ca.status, ca.config)
                 IS DISTINCT FROM
                 (mc.organization_id, 'whatsapp', mc.phone_number_id, mc.waba_id,
                  mc.display_phone_number, mc.verified_name, mc.token_cipher, mc.token_iv, mc.token_tag,
                  mc.status, channels_legacy_wa_config(mc.onboarding_mode, mc.app_disconnected_at)))
  UNION ALL
  -- V3: ogni contatto con wa_identity ha ESATTAMENTE un'identità whatsapp uguale;
  --     nessuna identità whatsapp diverge dal suo contatto o resta senza contatto.
  SELECT 'V3',
         (SELECT count(*) FROM contact c
           WHERE c.wa_identity IS NOT NULL
             AND (SELECT count(*) FROM contact_identity ci
                   WHERE ci.organization_id = c.organization_id AND ci.contact_id = c.id
                     AND ci.channel = 'whatsapp' AND ci.external_id = c.wa_identity) <> 1)
       + (SELECT count(*) FROM contact_identity ci
            LEFT JOIN contact c ON c.organization_id = ci.organization_id AND c.id = ci.contact_id
           WHERE ci.channel = 'whatsapp'
             AND (c.id IS NULL OR ci.external_id IS DISTINCT FROM c.wa_identity))
  UNION ALL
  -- V4: nessuna conversazione reale senza account in un'organizzazione che ne ha uno.
  SELECT 'V4',
         (SELECT count(*) FROM conversation cv
           WHERE cv.is_test = false AND cv.channel_account_id IS NULL
             AND EXISTS (SELECT 1 FROM channel_account ca
                          WHERE ca.organization_id = cv.organization_id AND ca.channel = 'whatsapp'))
  UNION ALL
  -- V5: external_message_id = wa_message_id dove wa_message_id c'è.
  SELECT 'V5',
         (SELECT count(*) FROM message
           WHERE wa_message_id IS NOT NULL AND external_message_id IS DISTINCT FROM wa_message_id)
  UNION ALL
  -- V6: isolamento — nessuna conversazione con l'account di un'altra
  --     organizzazione (o di un account che non esiste). Doppia sicurezza: lo
  --     impedisce già la FK composta.
  SELECT 'V6',
         (SELECT count(*) FROM conversation cv
            LEFT JOIN channel_account ca ON ca.id = cv.channel_account_id
           WHERE cv.channel_account_id IS NOT NULL
             AND (ca.id IS NULL OR ca.organization_id <> cv.organization_id))
$fn$;
