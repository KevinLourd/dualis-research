CREATE TABLE "gold"."document_pages" (
	"document_id" uuid NOT NULL,
	"page" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "document_pages_document_id_page_pk" PRIMARY KEY("document_id","page")
);
--> statement-breakpoint
CREATE TABLE "gold"."documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"registry" text NOT NULL,
	"kind" text NOT NULL,
	"form" text,
	"title" text NOT NULL,
	"filed_at" timestamp with time zone NOT NULL,
	"language" text NOT NULL,
	"view_url" text,
	"format" text NOT NULL,
	"page_count" integer NOT NULL,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."filing_documents" (
	"filing_id" uuid PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"registry" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"document_url" text,
	"view_url" text,
	"format" text,
	"page_count" integer,
	"chars" integer,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."filing_pages" (
	"filing_id" uuid NOT NULL,
	"page" integer NOT NULL,
	"text" text NOT NULL,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	CONSTRAINT "filing_pages_filing_id_page_pk" PRIMARY KEY("filing_id","page")
);
--> statement-breakpoint
CREATE INDEX "gold_documents_symbol_filed" ON "gold"."documents" USING btree ("symbol","filed_at");--> statement-breakpoint
CREATE INDEX "filing_documents_symbol" ON "silver"."filing_documents" USING btree ("symbol");