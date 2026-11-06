CREATE TYPE "gold"."news_coverage_status" AS ENUM('ok', 'empty', 'failed', 'not_covered');--> statement-breakpoint
CREATE TYPE "silver"."news_match_kind" AS ENUM('symbol', 'name', 'alias');--> statement-breakpoint
CREATE TABLE "gold"."news_coverage" (
	"source" text NOT NULL,
	"symbol" text NOT NULL,
	"market" "silver"."market" NOT NULL,
	"status" "gold"."news_coverage_status" NOT NULL,
	"items_last_answer" integer DEFAULT 0 NOT NULL,
	"items_30d" integer DEFAULT 0 NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"error" text,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_coverage_source_symbol_pk" PRIMARY KEY("source","symbol")
);
--> statement-breakpoint
CREATE TABLE "gold"."news_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"publisher" text,
	"summary" text,
	"image_url" text,
	"published_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"sources" text[] NOT NULL,
	"symbols" text[] NOT NULL,
	"markets" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."news_links" (
	"news_item_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"market" "silver"."market" NOT NULL,
	"published_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"match_kinds" text[] NOT NULL,
	"matched_terms" text[] NOT NULL,
	"sources" text[] NOT NULL,
	"matches" jsonb NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_links_news_item_id_symbol_pk" PRIMARY KEY("news_item_id","symbol")
);
--> statement-breakpoint
CREATE TABLE "silver"."news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"title_key" text NOT NULL,
	"url" text NOT NULL,
	"urls" text[] NOT NULL,
	"url_keys" text[] NOT NULL,
	"publisher" text,
	"summary" text,
	"image_url" text,
	"published_at" timestamp with time zone,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."news_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"news_item_id" uuid NOT NULL,
	"ticker_symbol" text NOT NULL,
	"match_kind" "silver"."news_match_kind" NOT NULL,
	"matched_term" text NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gold"."news_links" ADD CONSTRAINT "news_links_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "gold"."news_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silver"."news_mentions" ADD CONSTRAINT "news_mentions_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "silver"."news_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silver"."news_mentions" ADD CONSTRAINT "news_mentions_ticker_symbol_tickers_symbol_fk" FOREIGN KEY ("ticker_symbol") REFERENCES "silver"."tickers"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gold_news_items_published" ON "gold"."news_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "gold_news_links_symbol" ON "gold"."news_links" USING btree ("symbol","published_at");--> statement-breakpoint
CREATE INDEX "news_items_title_key" ON "silver"."news_items" USING btree ("title_key");--> statement-breakpoint
CREATE INDEX "news_items_published" ON "silver"."news_items" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "news_mentions_natural_key" ON "silver"."news_mentions" USING btree ("news_item_id","ticker_symbol","match_kind","matched_term");--> statement-breakpoint
CREATE INDEX "news_mentions_ticker" ON "silver"."news_mentions" USING btree ("ticker_symbol");