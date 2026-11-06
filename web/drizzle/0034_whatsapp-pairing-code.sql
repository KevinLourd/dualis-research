ALTER TABLE "ops"."whatsapp_link" ADD COLUMN "pairing_phone" text;--> statement-breakpoint
ALTER TABLE "ops"."whatsapp_link" ADD COLUMN "pairing_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."whatsapp_link" ADD COLUMN "pairing_code" text;