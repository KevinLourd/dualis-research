CREATE TABLE "gold"."operating_kpis" (
	"symbol" text NOT NULL,
	"kpi" text NOT NULL,
	"period_type" text NOT NULL,
	"period_end" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"unit_label" text,
	"currency" text,
	"value" double precision NOT NULL,
	"prior_value" double precision,
	"growth" double precision,
	"revenue" double precision,
	"revenue_basis" text,
	"revenue_ratio" double precision,
	"sources" text[] NOT NULL,
	"citation" jsonb NOT NULL,
	"alternatives" jsonb NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operating_kpis_symbol_kpi_period_type_period_end_pk" PRIMARY KEY("symbol","kpi","period_type","period_end")
);
--> statement-breakpoint
CREATE TABLE "silver"."operating_kpis" (
	"symbol" text NOT NULL,
	"kpi" text NOT NULL,
	"period_type" text NOT NULL,
	"period_end" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"unit_label" text,
	"currency" text,
	"value" double precision NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"observations" jsonb NOT NULL,
	"last_rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operating_kpis_symbol_kpi_period_type_period_end_pk" PRIMARY KEY("symbol","kpi","period_type","period_end")
);
--> statement-breakpoint
CREATE INDEX "gold_operating_kpis_symbol" ON "gold"."operating_kpis" USING btree ("symbol");