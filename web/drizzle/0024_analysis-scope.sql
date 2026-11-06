ALTER TABLE "silver"."tickers" ADD COLUMN "analysed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."tickers" ADD COLUMN "analysed" boolean DEFAULT true NOT NULL;