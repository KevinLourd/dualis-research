CREATE TABLE "silver"."intraday_bars" (
	"symbol" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
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
	CONSTRAINT "intraday_bars_symbol_at_pk" PRIMARY KEY("symbol","at")
);
--> statement-breakpoint
CREATE TABLE "gold"."intraday_bars" (
	"symbol" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"date" text NOT NULL,
	"close" double precision NOT NULL,
	"sources" text[] NOT NULL,
	CONSTRAINT "intraday_bars_symbol_at_pk" PRIMARY KEY("symbol","at")
);
--> statement-breakpoint
CREATE TABLE "gold"."live_benchmark" (
	"symbol" text PRIMARY KEY NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"base_date" text NOT NULL,
	"base_price" double precision NOT NULL,
	"base_at" timestamp with time zone NOT NULL,
	"base_source" text NOT NULL,
	"mark_date" text NOT NULL,
	"mark_price" double precision NOT NULL,
	"mark_at" timestamp with time zone NOT NULL,
	"mark_source" text NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gold"."live_positions" ADD COLUMN "entry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gold"."live_positions" ADD COLUMN "entry_source" text;--> statement-breakpoint
ALTER TABLE "gold"."live_positions" ADD COLUMN "exit_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gold"."live_positions" ADD COLUMN "exit_source" text;--> statement-breakpoint
ALTER TABLE "gold"."live_positions" ADD COLUMN "mark_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gold"."live_positions" ADD COLUMN "mark_source" text;