ALTER TABLE "gold"."quotes" ADD COLUMN "at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gold"."quotes" ADD COLUMN "source" text DEFAULT 'close' NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."market_reactions" ADD COLUMN "event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gold"."market_reactions" ADD COLUMN "price_at_event" double precision;--> statement-breakpoint
ALTER TABLE "gold"."market_reactions" ADD COLUMN "price_at_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gold"."market_reactions" ADD COLUMN "price_at_event_source" text;--> statement-breakpoint
ALTER TABLE "gold"."market_reactions" ADD COLUMN "price_now" double precision;--> statement-breakpoint
ALTER TABLE "gold"."market_reactions" ADD COLUMN "price_now_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gold"."market_reactions" ADD COLUMN "price_now_source" text;--> statement-breakpoint
ALTER TABLE "gold"."market_reactions" ADD COLUMN "return_since_event" double precision;--> statement-breakpoint
ALTER TABLE "gold"."market_reactions" ADD COLUMN "bench_since_event" double precision;