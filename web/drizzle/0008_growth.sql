CREATE TABLE "gold"."growth_audience" (
	"date" date PRIMARY KEY NOT NULL,
	"subscribers" integer NOT NULL,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."growth_outreach" (
	"handle" text PRIMARY KEY NOT NULL,
	"publication_name" text,
	"hook" text,
	"ask" text,
	"body" text NOT NULL,
	"body_source" text NOT NULL,
	"claude_body" text,
	"status" text NOT NULL,
	"status_at" timestamp with time zone,
	"contacts" jsonb NOT NULL,
	"rank" integer,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."growth_targets" (
	"publication_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"hero_text" text,
	"author_handle" text,
	"author_name" text,
	"subscribers" integer,
	"subscribers_at" date,
	"inbound" integer NOT NULL,
	"last_post_at" timestamp with time zone,
	"inactive" boolean NOT NULL,
	"fit" text,
	"fit_probability" double precision,
	"fit_sentence" text,
	"excluded_reason" text,
	"score" double precision NOT NULL,
	"rank" integer NOT NULL,
	"recent_posts" jsonb NOT NULL,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."outreach_messages" (
	"handle" text NOT NULL,
	"source" text NOT NULL,
	"publication_name" text,
	"hook" text,
	"ask" text,
	"body" text,
	"status" text,
	"status_at" timestamp with time zone,
	"contacts" jsonb,
	"rank" integer,
	"bronze_ids" uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_messages_handle_source_pk" PRIMARY KEY("handle","source")
);
--> statement-breakpoint
CREATE TABLE "silver"."substack_authors" (
	"handle" text PRIMARY KEY NOT NULL,
	"name" text,
	"user_id" text,
	"publication_ids" text[] NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."substack_publications" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"hero_text" text,
	"author_handle" text,
	"author_name" text,
	"payments_state" text,
	"reached_from" text[] NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."substack_recommendations" (
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "substack_recommendations_from_id_to_id_pk" PRIMARY KEY("from_id","to_id")
);
--> statement-breakpoint
CREATE INDEX "gold_growth_targets_author" ON "gold"."growth_targets" USING btree ("author_handle");--> statement-breakpoint
CREATE INDEX "substack_publications_author" ON "silver"."substack_publications" USING btree ("author_handle");--> statement-breakpoint
CREATE INDEX "substack_recommendations_to" ON "silver"."substack_recommendations" USING btree ("to_id");