CREATE TABLE "gold"."portfolio_positions" (
	"symbol" text PRIMARY KEY NOT NULL,
	"direction" text,
	"entry_date" text,
	"entry_price" double precision,
	"weight" double precision,
	"status" text,
	"reported_return" double precision,
	"reported_return_as_of" text,
	"provenance" jsonb NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
