CREATE TABLE "gold"."analyst_targets" (
	"symbol" text PRIMARY KEY NOT NULL,
	"low" double precision NOT NULL,
	"mean" double precision NOT NULL,
	"high" double precision NOT NULL,
	"analysts" integer,
	"currency" text,
	"sources" text[] NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."method_valuations" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"method" text NOT NULL,
	"applicable" integer NOT NULL,
	"reason" text,
	"currency" text,
	"low" double precision,
	"base" double precision,
	"high" double precision,
	"basis" text,
	"assumptions" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"inputs" jsonb NOT NULL,
	"history" jsonb,
	"peers" jsonb NOT NULL,
	"summary" text,
	"report" text,
	"version" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."method_valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"method" text NOT NULL,
	"input_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"model" text,
	"bronze_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."peer_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"input_hash" text NOT NULL,
	"peers" jsonb NOT NULL,
	"model" text,
	"bronze_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."peers" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"peer_symbol" text NOT NULL,
	"name" text,
	"why" text,
	"currency" text,
	"ev_ebitda" double precision,
	"pe" double precision,
	"market_cap" double precision,
	"sources" text[] NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."valuation_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"rank" integer NOT NULL,
	"name" text NOT NULL,
	"family" text NOT NULL,
	"description" text NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."valuation_reports" (
	"symbol" text PRIMARY KEY NOT NULL,
	"currency" text,
	"low" double precision NOT NULL,
	"base" double precision NOT NULL,
	"high" double precision NOT NULL,
	"weights" jsonb NOT NULL,
	"label" text NOT NULL,
	"summary" text NOT NULL,
	"markdown" text NOT NULL,
	"version" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."valuation_syntheses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"input_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"model" text,
	"bronze_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gold"."fair_values" ADD COLUMN "low" double precision;--> statement-breakpoint
ALTER TABLE "gold"."fair_values" ADD COLUMN "high" double precision;--> statement-breakpoint
CREATE INDEX "gold_method_valuations_symbol" ON "gold"."method_valuations" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "method_valuations_key" ON "silver"."method_valuations" USING btree ("symbol","method","input_hash");--> statement-breakpoint
CREATE INDEX "peer_sets_key" ON "silver"."peer_sets" USING btree ("symbol","input_hash");--> statement-breakpoint
CREATE INDEX "gold_peers_symbol" ON "gold"."peers" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "valuation_syntheses_key" ON "silver"."valuation_syntheses" USING btree ("symbol","input_hash");