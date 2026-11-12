CREATE TABLE "silver"."sandbox_image_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"day" text NOT NULL,
	"round" integer NOT NULL,
	"pass" integer NOT NULL,
	"all_ok" boolean NOT NULL,
	"posts" jsonb NOT NULL,
	"skill_hash" text NOT NULL,
	"model" text NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "silver"."sandbox_posts" ADD COLUMN "image_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_image_checks_key" ON "silver"."sandbox_image_checks" USING btree ("account_id","day","round","pass");