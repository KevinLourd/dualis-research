CREATE TABLE "silver"."content_messages" (
	"outbox_id" uuid PRIMARY KEY NOT NULL,
	"bronze_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"draft_id" uuid,
	"transition_id" text,
	"recipient" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sources" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."content_replies" (
	"wa_message_id" text PRIMARY KEY NOT NULL,
	"draft_id" uuid,
	"intent" text NOT NULL,
	"judgment_id" uuid,
	"new_draft_id" uuid,
	"outbox_id" uuid,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"handled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_messages_bronze" ON "silver"."content_messages" USING btree ("bronze_id");--> statement-breakpoint
CREATE INDEX "content_messages_draft" ON "silver"."content_messages" USING btree ("draft_id");