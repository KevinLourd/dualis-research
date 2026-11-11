CREATE TABLE "gold"."sandbox_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"tone" text NOT NULL,
	"display_name" text NOT NULL,
	"handle" text NOT NULL,
	"author" text NOT NULL,
	"bio" text NOT NULL,
	"url" text NOT NULL,
	"avatar_text" text NOT NULL,
	"avatar_color" text NOT NULL,
	"banner_color" text NOT NULL,
	"paired_account_id" text NOT NULL,
	"followers" integer NOT NULL,
	"following" integer NOT NULL,
	"joined" text NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."sandbox_posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"day" text NOT NULL,
	"slot" integer NOT NULL,
	"idea_id" uuid NOT NULL,
	"symbol" text,
	"text" text NOT NULL,
	"visual_id" uuid,
	"post_at" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."sandbox_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"tone" text NOT NULL,
	"display_name" text NOT NULL,
	"handle" text NOT NULL,
	"author" text NOT NULL,
	"bio" text NOT NULL,
	"url" text NOT NULL,
	"avatar_text" text NOT NULL,
	"avatar_color" text NOT NULL,
	"banner_color" text NOT NULL,
	"paired_account_id" text NOT NULL,
	"followers" integer NOT NULL,
	"following" integer NOT NULL,
	"joined" text NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."sandbox_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"day" text NOT NULL,
	"slot" integer NOT NULL,
	"idea_id" uuid NOT NULL,
	"symbol" text,
	"text" text NOT NULL,
	"visual_id" uuid,
	"post_at" timestamp with time zone NOT NULL,
	"model" text NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gold_sandbox_posts_account" ON "gold"."sandbox_posts" USING btree ("account_id","post_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_posts_natural_key" ON "silver"."sandbox_posts" USING btree ("account_id","day","slot");