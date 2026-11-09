-- Gold rebuilt by every run (analysis, evidence, narrative-state): emptied so the new NOT NULL columns and keys apply.
DELETE FROM "gold"."narratives";--> statement-breakpoint
DELETE FROM "gold"."narrative_drivers";--> statement-breakpoint
DELETE FROM "gold"."narrative_rationales";--> statement-breakpoint
DELETE FROM "gold"."research_reports";--> statement-breakpoint
DELETE FROM "gold"."narrative_states";--> statement-breakpoint
DELETE FROM "gold"."exhibits";--> statement-breakpoint
DELETE FROM "gold"."evidence";--> statement-breakpoint
CREATE TABLE "gold"."fair_value_history" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"day" text NOT NULL,
	"value" double precision NOT NULL,
	"low" double precision,
	"high" double precision,
	"currency" text,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."market_reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"event_day" text NOT NULL,
	"currency" text,
	"before_day" text,
	"close_before" double precision,
	"close_next" double precision,
	"close_5d" double precision,
	"now_day" text,
	"close_now" double precision,
	"return_next" double precision,
	"return_5d" double precision,
	"return_now" double precision,
	"bench_next" double precision,
	"bench_5d" double precision,
	"bench_now" double precision,
	"fv_day" text,
	"fv_then" double precision,
	"fv_low_then" double precision,
	"fv_high_then" double precision,
	"fv_now" double precision,
	"fv_low_now" double precision,
	"fv_high_now" double precision,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gold"."narrative_drivers" ALTER COLUMN "version" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "gold"."narrative_rationales" DROP CONSTRAINT IF EXISTS "narrative_rationales_pkey";--> statement-breakpoint
ALTER TABLE "gold"."narrative_rationales" ALTER COLUMN "version" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "gold"."narratives" DROP CONSTRAINT IF EXISTS "narratives_pkey";--> statement-breakpoint
ALTER TABLE "gold"."narratives" ALTER COLUMN "version" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "gold"."research_reports" DROP CONSTRAINT IF EXISTS "research_reports_pkey";--> statement-breakpoint
ALTER TABLE "gold"."research_reports" ALTER COLUMN "version" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "silver"."analyses" ADD COLUMN "side" text;--> statement-breakpoint
ALTER TABLE "gold"."narrative_drivers" ADD COLUMN "side" text NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."narrative_rationales" ADD COLUMN "id" text PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."narrative_rationales" ADD COLUMN "side" text NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."narrative_states" ADD COLUMN "side" text NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."narrative_states" ADD COLUMN "since" text;--> statement-breakpoint
ALTER TABLE "gold"."narrative_states" ADD COLUMN "priced_in" text;--> statement-breakpoint
ALTER TABLE "gold"."narrative_states" ADD COLUMN "signal" text;--> statement-breakpoint
ALTER TABLE "gold"."narratives" ADD COLUMN "id" text PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."narratives" ADD COLUMN "side" text NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."research_reports" ADD COLUMN "id" text PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."research_reports" ADD COLUMN "side" text NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."signals" ADD COLUMN "side" text;--> statement-breakpoint
ALTER TABLE "gold"."signals" ADD COLUMN "why" text;--> statement-breakpoint
ALTER TABLE "gold"."signals" ADD COLUMN "theses" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "gold_fair_value_history_symbol" ON "gold"."fair_value_history" USING btree ("symbol","day");--> statement-breakpoint
CREATE INDEX "gold_market_reactions_symbol" ON "gold"."market_reactions" USING btree ("symbol","event_day");