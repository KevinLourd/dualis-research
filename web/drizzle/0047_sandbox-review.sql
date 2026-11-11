CREATE TABLE "silver"."sandbox_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"day" text NOT NULL,
	"round" integer NOT NULL,
	"pass" boolean NOT NULL,
	"posts" jsonb NOT NULL,
	"edits" jsonb NOT NULL,
	"skill_hash" text NOT NULL,
	"model" text NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "silver"."sandbox_posts_natural_key";--> statement-breakpoint
ALTER TABLE "silver"."sandbox_posts" ADD COLUMN "round" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "silver"."sandbox_posts" ADD COLUMN "image" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_reviews_key" ON "silver"."sandbox_reviews" USING btree ("account_id","day","round");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_posts_round_key" ON "silver"."sandbox_posts" USING btree ("account_id","day","slot","round");