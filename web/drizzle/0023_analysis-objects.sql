CREATE TABLE "silver"."analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"input_hash" text NOT NULL,
	"analysis" jsonb NOT NULL,
	"report" text NOT NULL,
	"model" text NOT NULL,
	"bronze_id" uuid NOT NULL,
	"quote" double precision,
	"quote_date" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"driver_id" text,
	"effect" text NOT NULL,
	"strength" text NOT NULL,
	"probability" real NOT NULL,
	"why" text,
	"cited_sentence" text,
	"exhibit_id" text,
	"kind" text NOT NULL,
	"headline" text NOT NULL,
	"url" text,
	"publisher" text,
	"event_day" text NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"judgment_id" uuid NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."exhibits" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"driver_id" text NOT NULL,
	"rank" integer NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"chart" text NOT NULL,
	"series" jsonb NOT NULL,
	"points" jsonb NOT NULL,
	"takeaway" text NOT NULL,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."fair_values" (
	"symbol" text PRIMARY KEY NOT NULL,
	"value" double precision NOT NULL,
	"currency" text,
	"method" text,
	"author" text NOT NULL,
	"claude_value" double precision,
	"claude_method" text,
	"inputs" jsonb NOT NULL,
	"version" uuid,
	"as_of" timestamp with time zone,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."narrative_drivers" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"rank" integer NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"direction" text NOT NULL,
	"version" uuid NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."narratives" (
	"symbol" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"version" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."research_reports" (
	"symbol" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"markdown" text NOT NULL,
	"exhibit_ids" text[] NOT NULL,
	"version" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"model" text NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."signal_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"from_signal" text NOT NULL,
	"to_signal" text NOT NULL,
	"from_strength" text NOT NULL,
	"to_strength" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"update_note" text,
	"evidence_ids" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."signal_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"signal" text NOT NULL,
	"strength" text NOT NULL,
	"evidence_ids" text[] NOT NULL,
	"gap_pct" double precision,
	"at" timestamp with time zone NOT NULL,
	"baseline" integer DEFAULT 0 NOT NULL,
	"update_note" text,
	"model" text
);
--> statement-breakpoint
CREATE TABLE "gold"."signals" (
	"symbol" text PRIMARY KEY NOT NULL,
	"signal" text NOT NULL,
	"strength" text NOT NULL,
	"fair_value" double precision,
	"fair_value_method" text,
	"currency" text,
	"quote" double precision,
	"quote_date" text,
	"gap_pct" double precision,
	"evidence_ids" text[] NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analyses_symbol" ON "silver"."analyses" USING btree ("symbol","created_at");--> statement-breakpoint
CREATE INDEX "gold_evidence_symbol" ON "gold"."evidence" USING btree ("symbol","event_at");--> statement-breakpoint
CREATE INDEX "gold_exhibits_symbol" ON "gold"."exhibits" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "gold_narrative_drivers_symbol" ON "gold"."narrative_drivers" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "gold_signal_changes_at" ON "gold"."signal_changes" USING btree ("at");--> statement-breakpoint
CREATE INDEX "gold_signal_changes_symbol" ON "gold"."signal_changes" USING btree ("symbol","at");--> statement-breakpoint
CREATE INDEX "signal_states_symbol" ON "silver"."signal_states" USING btree ("symbol","at");