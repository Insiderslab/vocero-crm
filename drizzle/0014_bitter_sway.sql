ALTER TABLE "agent_profile" ADD COLUMN "restrict_to_allowlist" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "allowed_identities" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "outsider_reply" text;