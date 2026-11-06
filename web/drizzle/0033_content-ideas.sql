CREATE TABLE "silver"."content_draft_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"format" "silver"."content_format" NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"draft_id" uuid,
	"error" text,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."content_idea_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"format" "silver"."content_format" NOT NULL,
	"score" integer NOT NULL,
	"why" text NOT NULL,
	"model" text NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."content_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_bronze_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"day" text NOT NULL,
	"symbol" text,
	"title" text NOT NULL,
	"angle" text NOT NULL,
	"source_refs" jsonb NOT NULL,
	"model" text NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."content_ideas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"rank" integer NOT NULL,
	"symbol" text,
	"company_name" text,
	"title" text NOT NULL,
	"angle" text NOT NULL,
	"source_refs" jsonb NOT NULL,
	"scores" jsonb NOT NULL,
	"best_format" text,
	"best_score" integer,
	"requests" jsonb NOT NULL,
	"draft_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."content_published" (
	"id" text PRIMARY KEY NOT NULL,
	"format" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"tickers" text[] NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "silver"."content_drafts" ADD COLUMN "idea_id" uuid;--> statement-breakpoint
ALTER TABLE "gold"."content_drafts" ADD COLUMN "idea_id" uuid;--> statement-breakpoint
CREATE INDEX "content_draft_requests_idea" ON "silver"."content_draft_requests" USING btree ("idea_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_draft_requests_one_pending" ON "silver"."content_draft_requests" USING btree ("idea_id","format") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "content_idea_scores_natural_key" ON "silver"."content_idea_scores" USING btree ("idea_id","format");--> statement-breakpoint
CREATE UNIQUE INDEX "content_ideas_natural_key" ON "silver"."content_ideas" USING btree ("generation_bronze_id","rank");--> statement-breakpoint
CREATE INDEX "content_ideas_day" ON "silver"."content_ideas" USING btree ("day");--> statement-breakpoint
CREATE INDEX "gold_content_ideas_day" ON "gold"."content_ideas" USING btree ("day");--> statement-breakpoint
CREATE INDEX "gold_content_published_at" ON "gold"."content_published" USING btree ("published_at");