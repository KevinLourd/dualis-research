CREATE TABLE "gold"."x_publications" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"handle" text NOT NULL,
	"day" text NOT NULL,
	"slot" integer NOT NULL,
	"status" text NOT NULL,
	"tweet_id" text,
	"url" text,
	"error" text,
	"attempts" integer NOT NULL,
	"published_at" timestamp with time zone,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."x_connections" (
	"handle" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"refresh_token" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"token_refreshed_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."x_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"handle" text NOT NULL,
	"day" text NOT NULL,
	"slot" integer NOT NULL,
	"status" text NOT NULL,
	"tweet_id" text,
	"media_id" text,
	"text" text,
	"error" text,
	"attempts" integer NOT NULL,
	"published_at" timestamp with time zone,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gold_x_publications_account" ON "gold"."x_publications" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "x_publications_slot_key" ON "silver"."x_publications" USING btree ("account_id","day","slot");