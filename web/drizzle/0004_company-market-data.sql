CREATE TABLE "silver"."filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"registry" text NOT NULL,
	"filing_key" text NOT NULL,
	"form" text,
	"title" text NOT NULL,
	"filed_at" timestamp with time zone NOT NULL,
	"url" text,
	"language" text DEFAULT 'en' NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."insider_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"trade_key" text NOT NULL,
	"insider" text NOT NULL,
	"role" text,
	"trade_date" text NOT NULL,
	"filed_date" text,
	"shares" double precision NOT NULL,
	"price" double precision,
	"shares_after" double precision,
	"kind" text,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."price_bars" (
	"symbol" text NOT NULL,
	"date" text NOT NULL,
	"open" double precision,
	"high" double precision,
	"low" double precision,
	"close" double precision NOT NULL,
	"volume" double precision,
	"currency" text,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"observations" jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_bars_symbol_date_pk" PRIMARY KEY("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "gold"."earnings" (
	"symbol" text NOT NULL,
	"period" text NOT NULL,
	"report_date" text,
	"hour" text,
	"eps_actual" double precision,
	"eps_estimate" double precision,
	"revenue_actual" double precision,
	"revenue_estimate" double precision,
	"provenance" jsonb NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "earnings_symbol_period_pk" PRIMARY KEY("symbol","period")
);
--> statement-breakpoint
CREATE TABLE "gold"."filings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"registry" text NOT NULL,
	"filing_key" text NOT NULL,
	"form" text,
	"title" text NOT NULL,
	"filed_at" timestamp with time zone NOT NULL,
	"url" text,
	"language" text NOT NULL,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."insider_trades" (
	"id" uuid PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"insider" text NOT NULL,
	"role" text,
	"trade_date" text NOT NULL,
	"filed_date" text,
	"shares" double precision NOT NULL,
	"price" double precision,
	"shares_after" double precision,
	"kind" text,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."price_bars" (
	"symbol" text NOT NULL,
	"date" text NOT NULL,
	"open" double precision,
	"high" double precision,
	"low" double precision,
	"close" double precision NOT NULL,
	"volume" double precision,
	"sources" text[] NOT NULL,
	"alternatives" jsonb NOT NULL,
	CONSTRAINT "price_bars_symbol_date_pk" PRIMARY KEY("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "gold"."quotes" (
	"symbol" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"close" double precision NOT NULL,
	"previous_close" double precision,
	"change" double precision,
	"change_pct" double precision,
	"currency" text,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "filings_natural_key" ON "silver"."filings" USING btree ("registry","filing_key");--> statement-breakpoint
CREATE INDEX "filings_symbol_filed" ON "silver"."filings" USING btree ("symbol","filed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "insider_trades_natural_key" ON "silver"."insider_trades" USING btree ("symbol","trade_key");--> statement-breakpoint
CREATE INDEX "gold_filings_symbol_filed" ON "gold"."filings" USING btree ("symbol","filed_at");--> statement-breakpoint
CREATE INDEX "gold_insider_trades_symbol_date" ON "gold"."insider_trades" USING btree ("symbol","trade_date");