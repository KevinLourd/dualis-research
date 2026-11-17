ALTER TABLE "gold"."narrative_drivers" ADD COLUMN "move_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "gold"."narrative_states" ADD COLUMN "durability" text;--> statement-breakpoint
ALTER TABLE "gold"."narrative_states" ADD COLUMN "magnitude" jsonb;--> statement-breakpoint
ALTER TABLE "gold"."narrative_states" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "gold"."narrative_states" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "gold"."narrative_states" ADD COLUMN "citations" jsonb DEFAULT '[]'::jsonb NOT NULL;