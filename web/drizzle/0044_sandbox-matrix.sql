-- Phase 1 sandbox posts carry no format / angle: they are a test, rewritten today by the new writer.
DELETE FROM "gold"."sandbox_posts";--> statement-breakpoint
DELETE FROM "silver"."sandbox_posts";--> statement-breakpoint
CREATE TABLE "gold"."macro_news" (
	"id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"publisher" text,
	"published_at" timestamp with time zone,
	"queries" text[] NOT NULL,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."substack_trending" (
	"url" text PRIMARY KEY NOT NULL,
	"rank" integer NOT NULL,
	"host" text NOT NULL,
	"publication_name" text,
	"title" text NOT NULL,
	"subtitle" text,
	"post_date" timestamp with time zone NOT NULL,
	"audience" text,
	"wordcount" integer,
	"score" integer NOT NULL,
	"reactions" integer NOT NULL,
	"restacks" integer NOT NULL,
	"comments" integer NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."macro_news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url_key" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"publisher" text,
	"published_at" timestamp with time zone,
	"queries" text[] NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."substack_trending_posts" (
	"url" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"publication_name" text,
	"title" text NOT NULL,
	"subtitle" text,
	"post_date" timestamp with time zone NOT NULL,
	"audience" text,
	"wordcount" integer,
	"reactions" integer NOT NULL,
	"restacks" integer NOT NULL,
	"comments" integer NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gold"."sandbox_posts" ALTER COLUMN "idea_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "silver"."sandbox_posts" ALTER COLUMN "idea_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."sandbox_posts" ADD COLUMN "format" text NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."sandbox_posts" ADD COLUMN "angle" text NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."sandbox_posts" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "gold"."sandbox_posts" ADD COLUMN "subtitle" text;--> statement-breakpoint
ALTER TABLE "gold"."sandbox_posts" ADD COLUMN "input" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "silver"."sandbox_posts" ADD COLUMN "format" text NOT NULL;--> statement-breakpoint
ALTER TABLE "silver"."sandbox_posts" ADD COLUMN "angle" text NOT NULL;--> statement-breakpoint
ALTER TABLE "silver"."sandbox_posts" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "silver"."sandbox_posts" ADD COLUMN "subtitle" text;--> statement-breakpoint
ALTER TABLE "silver"."sandbox_posts" ADD COLUMN "input" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "silver"."sandbox_posts" ADD COLUMN "skill_hash" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "macro_news_items_url_key" ON "silver"."macro_news_items" USING btree ("url_key");--> statement-breakpoint
CREATE INDEX "macro_news_items_published" ON "silver"."macro_news_items" USING btree ("published_at");