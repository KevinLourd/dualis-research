-- The pre-convention tables in "public" (app skeleton #11) are replaced by silver/gold.
-- Their only data (37 tickers + 1 thesis note) comes back from data/watchlist.json on the next `collect watchlist`.
DROP TABLE IF EXISTS "public"."alerts" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "public"."drafts" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "public"."news_items" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "public"."catalysts" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "public"."drivers" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "public"."theses" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "public"."tickers" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."alert_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."author";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."draft_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."market";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."platform";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."position";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."thesis_status";
