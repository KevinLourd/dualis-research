CREATE TABLE "app"."notification_reads" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."thesis_assessments" (
	"judgment_id" uuid PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"evidence_key" text NOT NULL,
	"evidence_ids" text[] NOT NULL,
	"state" text NOT NULL,
	"probability" real NOT NULL,
	"reason" text,
	"cited_evidence" text,
	"assessed_at" timestamp with time zone NOT NULL,
	"bronze_id" uuid NOT NULL,
	"sources" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."thesis_confidence" (
	"symbol" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"probability" real,
	"reason" text,
	"evidence_count" integer NOT NULL,
	"assessed_at" timestamp with time zone,
	"since" timestamp with time zone,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."thesis_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"reason" text,
	"cited_evidence" text,
	"probability" real NOT NULL,
	"evidence_ids" text[] NOT NULL,
	"judgment_id" uuid NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "thesis_assessments_symbol" ON "silver"."thesis_assessments" USING btree ("symbol","assessed_at");--> statement-breakpoint
CREATE INDEX "thesis_transitions_at" ON "gold"."thesis_transitions" USING btree ("at");--> statement-breakpoint
CREATE INDEX "thesis_transitions_symbol" ON "gold"."thesis_transitions" USING btree ("symbol","at");