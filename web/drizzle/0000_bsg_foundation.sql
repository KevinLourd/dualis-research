CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE SCHEMA "bronze";
--> statement-breakpoint
CREATE SCHEMA "silver";
--> statement-breakpoint
CREATE SCHEMA "gold";
--> statement-breakpoint
CREATE TYPE "ops"."run_status" AS ENUM('running', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "ops"."source_status" AS ENUM('ok', 'partial', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "silver"."author" AS ENUM('thierry', 'claude');--> statement-breakpoint
CREATE TYPE "silver"."market" AS ENUM('US', 'CA', 'JP', 'KR', 'UK', 'HK', 'AU', 'EU');--> statement-breakpoint
CREATE TYPE "silver"."position" AS ENUM('long', 'short', 'watch');--> statement-breakpoint
CREATE TYPE "silver"."thesis_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TABLE "ops"."run_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" "ops"."source_status" NOT NULL,
	"requested" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"bronze_rows" integer DEFAULT 0 NOT NULL,
	"silver_rows" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dimension" text NOT NULL,
	"trigger" text NOT NULL,
	"status" "ops"."run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ci_url" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "bronze"."fetches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"source" text NOT NULL,
	"subject" text NOT NULL,
	"request" jsonb NOT NULL,
	"http_status" integer,
	"payload" jsonb,
	"payload_text" text,
	"error" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thesis_id" uuid NOT NULL,
	"name" text NOT NULL,
	"why" text NOT NULL,
	"signals" text[] DEFAULT '{}' NOT NULL,
	"rank" integer NOT NULL,
	"sources" text[] NOT NULL,
	"last_rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dimension" text NOT NULL,
	"subject" text NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"value_key" text NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."judgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"question_key" text NOT NULL,
	"question" text NOT NULL,
	"verdict" text NOT NULL,
	"probability" real NOT NULL,
	"cited_sentence" text,
	"model" text NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."theses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker_symbol" text NOT NULL,
	"summary" text NOT NULL,
	"kill_criteria" text,
	"author" "silver"."author" NOT NULL,
	"status" "silver"."thesis_status" DEFAULT 'draft' NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"last_rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."tickers" (
	"symbol" text PRIMARY KEY NOT NULL,
	"market" "silver"."market" NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"in_portfolio" boolean DEFAULT false NOT NULL,
	"position" "silver"."position" DEFAULT 'watch' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."company_profiles" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text,
	"exchange" text,
	"currency" text,
	"country" text,
	"sector" text,
	"industry" text,
	"description" text,
	"website" text,
	"logo_url" text,
	"market_cap" double precision,
	"employees" integer,
	"ipo_date" text,
	"provenance" jsonb NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."tickers" (
	"symbol" text PRIMARY KEY NOT NULL,
	"market" "silver"."market" NOT NULL,
	"aliases" text[] NOT NULL,
	"in_portfolio" boolean NOT NULL,
	"position" "silver"."position" NOT NULL,
	"thesis_note" text,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops"."run_sources" ADD CONSTRAINT "run_sources_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "ops"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bronze"."fetches" ADD CONSTRAINT "fetches_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "ops"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silver"."drivers" ADD CONSTRAINT "drivers_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "silver"."theses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silver"."theses" ADD CONSTRAINT "theses_ticker_symbol_tickers_symbol_fk" FOREIGN KEY ("ticker_symbol") REFERENCES "silver"."tickers"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fetches_dimension_source_subject" ON "bronze"."fetches" USING btree ("dimension","source","subject","fetched_at");--> statement-breakpoint
CREATE INDEX "fetches_run" ON "bronze"."fetches" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "facts_natural_key" ON "silver"."facts" USING btree ("dimension","subject","field","value_key");--> statement-breakpoint
CREATE UNIQUE INDEX "judgments_natural_key" ON "silver"."judgments" USING btree ("subject_kind","subject_id","question_key");--> statement-breakpoint
CREATE UNIQUE INDEX "theses_ticker_author" ON "silver"."theses" USING btree ("ticker_symbol","author");