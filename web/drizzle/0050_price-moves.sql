CREATE TABLE "gold"."price_move_causes" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"kind" text NOT NULL,
	"fact" text,
	"category" text,
	"cites" jsonb NOT NULL,
	"candidates" integer NOT NULL,
	"confidence" real,
	"judgment_id" uuid,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."price_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"start_day" text NOT NULL,
	"end_day" text NOT NULL,
	"days" integer NOT NULL,
	"currency" text,
	"close_before" double precision NOT NULL,
	"close_end" double precision NOT NULL,
	"return_pct" double precision NOT NULL,
	"bench_return" double precision,
	"abnormal" double precision NOT NULL,
	"z" double precision NOT NULL,
	"beta" double precision NOT NULL,
	"direction" text NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gold_price_move_causes_symbol" ON "gold"."price_move_causes" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "gold_price_moves_symbol" ON "gold"."price_moves" USING btree ("symbol","start_day");