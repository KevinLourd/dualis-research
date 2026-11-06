CREATE TABLE "gold"."narrative_rationales" (
	"symbol" text PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"claims" jsonb NOT NULL,
	"exhibit_ids" text[] NOT NULL,
	"version" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "silver"."analyses" ADD COLUMN "rationale" jsonb;--> statement-breakpoint
ALTER TABLE "gold"."evidence" ADD COLUMN "news_item_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."evidence" ADD COLUMN "filing_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."evidence" ADD COLUMN "sources" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."fair_values" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "gold"."narrative_drivers" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "gold"."narratives" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "gold"."signals" ADD COLUMN "fair_value_label" text;