CREATE TABLE "silver"."catalyst_events" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"kind" text NOT NULL,
	"driver_id" text NOT NULL,
	"direction" text NOT NULL,
	"event_day" text NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"probability" real NOT NULL,
	"reason" text,
	"evidence" text,
	"top_news_item_id" uuid,
	"news_item_ids" uuid[] NOT NULL,
	"judgment_ids" uuid[] NOT NULL,
	"sources" text[] NOT NULL,
	"last_rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."catalysts" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"kind" text NOT NULL,
	"event_day" text NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"driver_id" text NOT NULL,
	"driver_name" text NOT NULL,
	"pillar_slot" integer,
	"pillar_text" text,
	"direction" text NOT NULL,
	"probability" real NOT NULL,
	"reason" text,
	"evidence" text,
	"headline" text NOT NULL,
	"url" text,
	"publisher" text,
	"news_item_ids" uuid[] NOT NULL,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."ticker_days" (
	"day" text NOT NULL,
	"symbol" text NOT NULL,
	"status" text NOT NULL,
	"catalysts" integer NOT NULL,
	"top_catalyst_id" text,
	"top_direction" text,
	"articles" integer NOT NULL,
	"judged" integer NOT NULL,
	"reason" text NOT NULL,
	"entered" boolean NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticker_days_day_symbol_pk" PRIMARY KEY("day","symbol")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalyst_events_natural_key" ON "silver"."catalyst_events" USING btree ("driver_id","direction","event_day");--> statement-breakpoint
CREATE INDEX "catalyst_events_symbol" ON "silver"."catalyst_events" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "gold_catalysts_symbol" ON "gold"."catalysts" USING btree ("symbol","event_at");--> statement-breakpoint
CREATE INDEX "gold_catalysts_day" ON "gold"."catalysts" USING btree ("event_day");