CREATE TABLE "bot_api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"label" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "bot_api_key" ADD CONSTRAINT "bot_api_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_api_key_hash_uq" ON "bot_api_key" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "bot_api_key_org_idx" ON "bot_api_key" USING btree ("organization_id","created_at");