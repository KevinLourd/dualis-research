CREATE TYPE "silver"."channel_kind" AS ENUM('substack', 'x', 'linkedin');--> statement-breakpoint
CREATE TYPE "silver"."content_format" AS ENUM('substack-article', 'substack-note', 'x-post', 'linkedin-post');--> statement-breakpoint
CREATE TYPE "silver"."draft_status" AS ENUM('draft', 'approved', 'posted', 'dismissed');--> statement-breakpoint
CREATE TABLE "silver"."content_channels" (
	"kind" "silver"."channel_kind" PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."content_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_bronze_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"input_key" text NOT NULL,
	"format" "silver"."content_format" NOT NULL,
	"version" integer NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"status" "silver"."draft_status" DEFAULT 'draft' NOT NULL,
	"status_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_url" text,
	"model" text NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."content_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url_key" text NOT NULL,
	"url" text NOT NULL,
	"publication_host" text NOT NULL,
	"format" "silver"."content_format" NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"author" text,
	"published_at" timestamp with time zone,
	"audience" text,
	"word_count" integer,
	"image_url" text,
	"topics" text[] NOT NULL,
	"tickers" text[] NOT NULL,
	"tickers_by_source" jsonb NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."content_publications" (
	"host" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"author" text,
	"description" text,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."content_channels" (
	"kind" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."content_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"input_key" text NOT NULL,
	"format" text NOT NULL,
	"version" integer NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"status" text NOT NULL,
	"status_at" timestamp with time zone NOT NULL,
	"posted_url" text,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."content_library" (
	"id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"publication_host" text NOT NULL,
	"publication_name" text NOT NULL,
	"publication_kind" text NOT NULL,
	"format" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"author" text,
	"published_at" timestamp with time zone,
	"audience" text,
	"word_count" integer,
	"image_url" text,
	"topics" text[] NOT NULL,
	"tickers" text[] NOT NULL,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."content_publications" (
	"host" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"author" text,
	"description" text,
	"posts" integer NOT NULL,
	"latest_post_at" timestamp with time zone,
	"source_health" jsonb NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "silver"."content_posts" ADD CONSTRAINT "content_posts_publication_host_content_publications_host_fk" FOREIGN KEY ("publication_host") REFERENCES "silver"."content_publications"("host") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_drafts_natural_key" ON "silver"."content_drafts" USING btree ("generation_bronze_id","format");--> statement-breakpoint
CREATE INDEX "content_drafts_symbol_input" ON "silver"."content_drafts" USING btree ("symbol","input_key","format");--> statement-breakpoint
CREATE UNIQUE INDEX "content_posts_url_key" ON "silver"."content_posts" USING btree ("url_key");--> statement-breakpoint
CREATE INDEX "content_posts_published" ON "silver"."content_posts" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "gold_content_drafts_created" ON "gold"."content_drafts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "gold_content_library_published" ON "gold"."content_library" USING btree ("published_at");