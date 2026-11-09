ALTER TABLE "gold"."method_valuations" ADD COLUMN "peer_pricing" jsonb;--> statement-breakpoint
ALTER TABLE "gold"."peers" ADD COLUMN "pe_forward" double precision;--> statement-breakpoint
ALTER TABLE "gold"."peers" ADD COLUMN "pb" double precision;--> statement-breakpoint
ALTER TABLE "gold"."peers" ADD COLUMN "revenue_growth" double precision;--> statement-breakpoint
ALTER TABLE "gold"."peers" ADD COLUMN "ebitda_margin" double precision;