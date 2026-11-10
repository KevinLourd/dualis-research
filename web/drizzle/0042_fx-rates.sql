CREATE TABLE "silver"."fx_rates" (
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"date" text NOT NULL,
	"rate" double precision NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_base_quote_date_pk" PRIMARY KEY("base","quote","date")
);
--> statement-breakpoint
CREATE TABLE "gold"."fx_rates" (
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"date" text NOT NULL,
	"rate" double precision NOT NULL,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_base_quote_date_pk" PRIMARY KEY("base","quote","date")
);
--> statement-breakpoint
ALTER TABLE "gold"."fair_value_history" ADD COLUMN "conversion" jsonb;--> statement-breakpoint
ALTER TABLE "gold"."fair_values" ADD COLUMN "conversion" jsonb;