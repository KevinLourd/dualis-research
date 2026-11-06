CREATE TABLE "silver"."content_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" "silver"."channel_kind" NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"handle" text NOT NULL,
	"samples" text[] NOT NULL,
	"website_text" text,
	"active" boolean DEFAULT true NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."content_voices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"input_key" text NOT NULL,
	"guide" text NOT NULL,
	"basis" text NOT NULL,
	"model" text NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."content_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"handle" text NOT NULL,
	"samples" integer NOT NULL,
	"voice_guide" text,
	"voice_basis" text,
	"voice_at" timestamp with time zone,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "silver"."content_drafts_natural_key";--> statement-breakpoint
ALTER TABLE "silver"."content_drafts" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "silver"."content_drafts" ADD COLUMN "charts" jsonb;--> statement-breakpoint
ALTER TABLE "silver"."content_drafts" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "silver"."content_posts" ADD COLUMN "excerpt" text;--> statement-breakpoint
ALTER TABLE "gold"."content_drafts" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "gold"."content_drafts" ADD COLUMN "account_name" text;--> statement-breakpoint
ALTER TABLE "gold"."content_drafts" ADD COLUMN "charts" jsonb;--> statement-breakpoint
ALTER TABLE "gold"."content_drafts" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "content_voices_natural_key" ON "silver"."content_voices" USING btree ("account_id","input_key");--> statement-breakpoint
CREATE UNIQUE INDEX "content_drafts_natural_key" ON "silver"."content_drafts" USING btree ("generation_bronze_id","format","account_id") NULLS NOT DISTINCT;