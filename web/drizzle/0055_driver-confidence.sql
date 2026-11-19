CREATE TABLE "gold"."driver_confidence" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"level" text NOT NULL,
	"reason" text NOT NULL,
	"origin_move_ids" text[] NOT NULL,
	"rows" jsonb NOT NULL,
	"explained" integer NOT NULL,
	"contradicted" integer NOT NULL,
	"tested" integer NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"judgment_id" uuid,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gold"."narrative_states" ALTER COLUMN "judgment_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "gold_driver_confidence_symbol" ON "gold"."driver_confidence" USING btree ("symbol");