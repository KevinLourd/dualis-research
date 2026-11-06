CREATE TABLE "silver"."financial_lines" (
	"symbol" text NOT NULL,
	"period_type" text NOT NULL,
	"period_end" text NOT NULL,
	"line" text NOT NULL,
	"statement" text NOT NULL,
	"value" double precision NOT NULL,
	"currency" text,
	"label" text NOT NULL,
	"consolidated" boolean,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"observations" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_lines_symbol_period_type_period_end_line_pk" PRIMARY KEY("symbol","period_type","period_end","line")
);
--> statement-breakpoint
CREATE TABLE "gold"."financial_metrics" (
	"symbol" text NOT NULL,
	"period_type" text NOT NULL,
	"period_end" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"currency" text,
	"formula" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_metrics_symbol_period_type_period_end_metric_pk" PRIMARY KEY("symbol","period_type","period_end","metric")
);
--> statement-breakpoint
CREATE TABLE "gold"."financial_lines" (
	"symbol" text NOT NULL,
	"period_type" text NOT NULL,
	"period_end" text NOT NULL,
	"line" text NOT NULL,
	"statement" text NOT NULL,
	"value" double precision NOT NULL,
	"currency" text,
	"label" text NOT NULL,
	"consolidated" boolean,
	"sources" text[] NOT NULL,
	"alternatives" jsonb NOT NULL,
	"citation" jsonb,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_lines_symbol_period_type_period_end_line_pk" PRIMARY KEY("symbol","period_type","period_end","line")
);
--> statement-breakpoint
CREATE TABLE "gold"."valuations" (
	"symbol" text PRIMARY KEY NOT NULL,
	"currency" text,
	"quote_currency" text,
	"last_fiscal_year" text,
	"years_covered" integer NOT NULL,
	"ev_ebitda_low" double precision,
	"ev_ebitda_median" double precision,
	"ev_ebitda_high" double precision,
	"ev_ebitda_years" text[] NOT NULL,
	"quote_date" text,
	"quote" double precision,
	"shares_outstanding" double precision,
	"net_debt" double precision,
	"ebitda" double precision,
	"ebitda_basis" text,
	"market_cap" double precision,
	"ev" double precision,
	"ev_ebitda" double precision,
	"inputs" jsonb NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gold_financial_metrics_symbol" ON "gold"."financial_metrics" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "gold_financial_lines_symbol" ON "gold"."financial_lines" USING btree ("symbol");