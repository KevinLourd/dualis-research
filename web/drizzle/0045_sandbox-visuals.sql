CREATE TABLE "silver"."sandbox_visuals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"symbol" text,
	"status" text NOT NULL,
	"error" text,
	"mime" text,
	"width" integer,
	"height" integer,
	"file" "bytea",
	"size_bytes" integer,
	"caption" text,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_visuals_key_unique" UNIQUE("key")
);
