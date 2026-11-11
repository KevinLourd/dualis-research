CREATE TABLE "gold"."revenue_streams" (
	"symbol" text NOT NULL,
	"line" text NOT NULL,
	"axis" text NOT NULL,
	"name" text NOT NULL,
	"period_type" text NOT NULL,
	"period_end" text NOT NULL,
	"value" double precision NOT NULL,
	"currency" text,
	"prior_value" double precision,
	"growth" double precision,
	"share_of_total" double precision,
	"axis_coverage" double precision,
	"ltm_value" double precision,
	"ltm_prior" double precision,
	"ltm_growth" double precision,
	"ltm_formula" text,
	"sources" text[] NOT NULL,
	"citation" jsonb,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revenue_streams_symbol_line_period_type_period_end_pk" PRIMARY KEY("symbol","line","period_type","period_end")
);
--> statement-breakpoint
CREATE INDEX "gold_revenue_streams_symbol" ON "gold"."revenue_streams" USING btree ("symbol");