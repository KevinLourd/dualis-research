CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."news_visits" (
	"user_id" text PRIMARY KEY NOT NULL,
	"previous_visit_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
