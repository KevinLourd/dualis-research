CREATE TABLE "gold"."consensus" (
	"symbol" text NOT NULL,
	"period_type" text NOT NULL,
	"period_end" text NOT NULL,
	"metric" text NOT NULL,
	"currency" text,
	"low" double precision,
	"mean" double precision,
	"high" double precision,
	"analysts" integer,
	"actual" double precision,
	"provenance" jsonb NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consensus_symbol_period_type_period_end_metric_pk" PRIMARY KEY("symbol","period_type","period_end","metric")
);
--> statement-breakpoint
CREATE TABLE "gold"."consensus_coverage" (
	"source" text NOT NULL,
	"symbol" text NOT NULL,
	"market" "silver"."market" NOT NULL,
	"status" text NOT NULL,
	"estimate_periods" integer DEFAULT 0 NOT NULL,
	"actual_periods" integer DEFAULT 0 NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"error" text,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consensus_coverage_source_symbol_pk" PRIMARY KEY("source","symbol")
);
--> statement-breakpoint
CREATE INDEX "gold_consensus_symbol" ON "gold"."consensus" USING btree ("symbol");