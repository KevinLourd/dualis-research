CREATE TABLE "silver"."calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"rating" text NOT NULL,
	"target_price" double precision,
	"currency" text,
	"horizon_months" integer NOT NULL,
	"opened_on" text NOT NULL,
	"price_at_open" double precision,
	"closed_on" text,
	"price_at_close" double precision,
	"close_reason" text,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"last_rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"rating" text NOT NULL,
	"target_price" double precision,
	"currency" text,
	"horizon_months" integer NOT NULL,
	"opened_on" text NOT NULL,
	"price_at_open" double precision,
	"closed_on" text,
	"price_at_close" double precision,
	"close_reason" text,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gold"."theses" ADD COLUMN "rating" text;--> statement-breakpoint
ALTER TABLE "gold"."theses" ADD COLUMN "target_price" double precision;--> statement-breakpoint
ALTER TABLE "gold"."theses" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "gold"."theses" ADD COLUMN "horizon_months" integer;--> statement-breakpoint
ALTER TABLE "gold"."theses" ADD COLUMN "valuation" text;--> statement-breakpoint
ALTER TABLE "gold"."theses" ADD COLUMN "opened_on" text;--> statement-breakpoint
ALTER TABLE "gold"."theses" ADD COLUMN "price_at_open" double precision;--> statement-breakpoint
ALTER TABLE "gold"."theses" ADD COLUMN "pillar_status" jsonb;--> statement-breakpoint
ALTER TABLE "gold"."theses" ADD COLUMN "pillars_on_track" integer;--> statement-breakpoint
ALTER TABLE "gold"."thesis_items" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "gold"."thesis_items" ADD COLUMN "pillar_slot" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "calls_symbol_opened" ON "silver"."calls" USING btree ("symbol","opened_on");--> statement-breakpoint
CREATE INDEX "gold_calls_symbol" ON "gold"."calls" USING btree ("symbol");