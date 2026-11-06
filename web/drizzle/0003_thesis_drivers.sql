CREATE TABLE "gold"."driver_conclusions" (
	"judgment_id" uuid PRIMARY KEY NOT NULL,
	"driver_id" text NOT NULL,
	"symbol" text NOT NULL,
	"as_of" text NOT NULL,
	"verdict" text NOT NULL,
	"probability" real NOT NULL,
	"cited_sentence" text,
	"judged_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."driver_points" (
	"driver_id" text NOT NULL,
	"date" text NOT NULL,
	"value" double precision NOT NULL,
	CONSTRAINT "driver_points_driver_id_date_pk" PRIMARY KEY("driver_id","date")
);
--> statement-breakpoint
CREATE TABLE "gold"."drivers" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"slot" integer NOT NULL,
	"name" text NOT NULL,
	"why" text NOT NULL,
	"kind" text NOT NULL,
	"value_driver" text NOT NULL,
	"category" text NOT NULL,
	"pillar_slot" integer,
	"signals" text[] NOT NULL,
	"series" jsonb,
	"series_label" text,
	"unit" text,
	"data_status" text NOT NULL,
	"data_note" text,
	"data_sources" text[] NOT NULL,
	"latest_date" text,
	"latest_value" double precision,
	"sources" text[] NOT NULL,
	"state" text NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."theses" (
	"symbol" text PRIMARY KEY NOT NULL,
	"summary" text,
	"summary_state" text,
	"claude_summary" text,
	"thierry_summary" text,
	"position" text,
	"draft_as_of" text,
	"status" text NOT NULL,
	"supports" integer DEFAULT 0 NOT NULL,
	"weakens" integer DEFAULT 0 NOT NULL,
	"neutral" integer DEFAULT 0 NOT NULL,
	"concluded_at" text,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."thesis_items" (
	"symbol" text NOT NULL,
	"kind" text NOT NULL,
	"slot" integer NOT NULL,
	"claude_text" text,
	"thierry_text" text,
	"active_text" text NOT NULL,
	"state" text NOT NULL,
	"sources" text[] NOT NULL,
	"expected_on" text,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thesis_items_symbol_kind_slot_pk" PRIMARY KEY("symbol","kind","slot")
);
--> statement-breakpoint
CREATE INDEX "driver_conclusions_driver" ON "gold"."driver_conclusions" USING btree ("driver_id","as_of");--> statement-breakpoint
CREATE INDEX "drivers_symbol" ON "gold"."drivers" USING btree ("symbol");