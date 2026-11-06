ALTER TABLE "silver"."calls" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gold"."driver_conclusions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gold"."driver_points" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gold"."drivers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gold"."calls" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gold"."thesis_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gold"."ticker_days" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "silver"."calls" CASCADE;--> statement-breakpoint
DROP TABLE "gold"."driver_conclusions" CASCADE;--> statement-breakpoint
DROP TABLE "gold"."driver_points" CASCADE;--> statement-breakpoint
DROP TABLE "gold"."drivers" CASCADE;--> statement-breakpoint
DROP TABLE "gold"."calls" CASCADE;--> statement-breakpoint
DROP TABLE "gold"."thesis_items" CASCADE;--> statement-breakpoint
DROP TABLE "gold"."ticker_days" CASCADE;--> statement-breakpoint
-- Rebuilt from silver.judgments on every run: the old driver-based rows and confidence states cannot carry over.
DELETE FROM "silver"."catalyst_events";--> statement-breakpoint
DELETE FROM "gold"."catalysts";--> statement-breakpoint
DELETE FROM "silver"."thesis_assessments";--> statement-breakpoint
DELETE FROM "gold"."thesis_confidence";--> statement-breakpoint
DELETE FROM "gold"."thesis_transitions";--> statement-breakpoint
DROP INDEX "silver"."catalyst_events_natural_key";--> statement-breakpoint
ALTER TABLE "gold"."theses" ADD COLUMN "narrative" text;--> statement-breakpoint
ALTER TABLE "gold"."theses" ADD COLUMN "narrative_state" text;--> statement-breakpoint
ALTER TABLE "gold"."theses" ADD COLUMN "fair_value" double precision;--> statement-breakpoint
ALTER TABLE "gold"."theses" ADD COLUMN "fair_value_basis" text;--> statement-breakpoint
ALTER TABLE "silver"."catalyst_events" ADD COLUMN "top_item" text;--> statement-breakpoint
ALTER TABLE "silver"."catalyst_events" ADD COLUMN "filing_ids" uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."catalysts" ADD COLUMN "filing_ids" uuid[] NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "catalyst_events_key" ON "silver"."catalyst_events" USING btree ("symbol","direction","event_day");--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "claude_summary";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "thierry_summary";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "supports";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "weakens";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "neutral";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "concluded_at";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "rating";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "target_price";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "horizon_months";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "valuation";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "opened_on";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "price_at_open";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "pillar_status";--> statement-breakpoint
ALTER TABLE "gold"."theses" DROP COLUMN "pillars_on_track";--> statement-breakpoint
ALTER TABLE "silver"."catalyst_events" DROP COLUMN "driver_id";--> statement-breakpoint
ALTER TABLE "silver"."catalyst_events" DROP COLUMN "top_news_item_id";--> statement-breakpoint
ALTER TABLE "gold"."catalysts" DROP COLUMN "driver_id";--> statement-breakpoint
ALTER TABLE "gold"."catalysts" DROP COLUMN "driver_name";--> statement-breakpoint
ALTER TABLE "gold"."catalysts" DROP COLUMN "pillar_slot";--> statement-breakpoint
ALTER TABLE "gold"."catalysts" DROP COLUMN "pillar_text";