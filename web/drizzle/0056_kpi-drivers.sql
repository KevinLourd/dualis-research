CREATE TABLE "gold"."kpi_drivers" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"rank" integer NOT NULL,
	"name" text NOT NULL,
	"why" text NOT NULL,
	"series" text,
	"approximation" text,
	"level" text,
	"reason" text,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed" integer DEFAULT 0 NOT NULL,
	"invalidated" integer DEFAULT 0 NOT NULL,
	"signal" text,
	"signal_why" text,
	"direction" text,
	"as_of" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gold_kpi_drivers_symbol" ON "gold"."kpi_drivers" USING btree ("symbol");