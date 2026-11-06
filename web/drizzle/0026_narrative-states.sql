CREATE TABLE "gold"."narrative_states" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"level" text NOT NULL,
	"driver_id" text,
	"effect" text NOT NULL,
	"strength" text NOT NULL,
	"why" text,
	"probability" real NOT NULL,
	"evidence_ids" text[] NOT NULL,
	"judgment_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DELETE FROM "gold"."evidence";--> statement-breakpoint
ALTER TABLE "gold"."evidence" ADD COLUMN "verdicts" jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "gold_narrative_states_symbol" ON "gold"."narrative_states" USING btree ("symbol");--> statement-breakpoint
ALTER TABLE "gold"."narrative_drivers" DROP COLUMN "direction";