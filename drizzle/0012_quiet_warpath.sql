CREATE TABLE "wa_address_book_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"wa_identity" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN "onboarding_mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN "app_disconnected_at" timestamp;--> statement-breakpoint
ALTER TABLE "wa_address_book_entry" ADD CONSTRAINT "wa_address_book_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wa_address_book_org_identity_uq" ON "wa_address_book_entry" USING btree ("organization_id","wa_identity");