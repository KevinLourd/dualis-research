CREATE TABLE "gold"."live_positions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"strength" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"entry_date" text,
	"entry_price" double precision,
	"exit_date" text,
	"exit_price" double precision,
	"mark_date" text,
	"mark_price" double precision,
	"return" double precision,
	"currency" text,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."signal_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"signal" text NOT NULL,
	"strength" text NOT NULL,
	"from_signal" text,
	"from_strength" text,
	"update_note" text,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gold_live_positions_symbol" ON "gold"."live_positions" USING btree ("symbol","opened_at");--> statement-breakpoint
CREATE INDEX "gold_signal_events_at" ON "gold"."signal_events" USING btree ("at");