CREATE TABLE "gold"."whatsapp_conversation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wa_message_id" text NOT NULL,
	"contact" text NOT NULL,
	"contact_name" text NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"text" text,
	"transcript" text,
	"media_mime" text,
	"reply_to_wa_id" text,
	"outbox_id" uuid,
	"delivery" text,
	"sent_at" timestamp with time zone NOT NULL,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."whatsapp_auth" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."whatsapp_link" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"qr_svg" text,
	"phone" text,
	"error" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_message_id" text NOT NULL,
	"contact" text NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"transcript" text,
	"transcript_model" text,
	"media_mime" text,
	"media_bronze_id" uuid,
	"reply_to_wa_id" text,
	"outbox_id" uuid,
	"delivery" text,
	"sent_at" timestamp with time zone NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."whatsapp_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient" text NOT NULL,
	"text" text,
	"image_url" text,
	"image" "bytea",
	"image_mime" text,
	"reply_to_wa_id" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"wa_message_id" text,
	"error" text,
	"result_bronze_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gold_whatsapp_conversation_contact_sent" ON "gold"."whatsapp_conversation" USING btree ("contact","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_messages_wa_id" ON "silver"."whatsapp_messages" USING btree ("wa_message_id");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_contact_sent" ON "silver"."whatsapp_messages" USING btree ("contact","sent_at");--> statement-breakpoint
CREATE INDEX "whatsapp_outbox_due" ON "app"."whatsapp_outbox" USING btree ("status","scheduled_at");