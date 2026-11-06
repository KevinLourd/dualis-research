CREATE TABLE "silver"."content_visuals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"mime" text,
	"width" integer,
	"height" integer,
	"file" "bytea",
	"size_bytes" integer,
	"source_url" text,
	"caption" text,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."content_visuals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idea_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"mime" text,
	"width" integer,
	"height" integer,
	"size_bytes" integer,
	"source_url" text,
	"caption" text,
	"created_at" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_visuals_natural_key" ON "silver"."content_visuals" USING btree ("idea_id","kind","version");--> statement-breakpoint
CREATE INDEX "gold_content_visuals_idea" ON "gold"."content_visuals" USING btree ("idea_id");