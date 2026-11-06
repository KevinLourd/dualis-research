CREATE TABLE "app"."onedrive_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"pending_device_code" text,
	"pending_user_code" text,
	"pending_verification_uri" text,
	"pending_expires_at" timestamp with time zone,
	"account" text,
	"refresh_token" text,
	"scope" text,
	"connected_at" timestamp with time zone,
	"token_refreshed_at" timestamp with time zone,
	"root_item_id" text,
	"root_path" text,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold"."onedrive_documents" (
	"item_id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"folder_name" text NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"size" bigint,
	"modified_at" timestamp with time zone,
	"web_url" text,
	"excerpt" text,
	"saved_by_dualis" boolean NOT NULL,
	"sources" text[] NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."onedrive_files" (
	"item_id" text PRIMARY KEY NOT NULL,
	"folder_item_id" text NOT NULL,
	"symbol" text,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"kind" text NOT NULL,
	"size" bigint,
	"mime_type" text,
	"modified_at" timestamp with time zone,
	"web_url" text,
	"excerpt" text,
	"filing_id" uuid,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silver"."onedrive_folders" (
	"item_id" text PRIMARY KEY NOT NULL,
	"symbol" text,
	"name" text NOT NULL,
	"web_url" text,
	"matched_by" text,
	"listed_at" timestamp with time zone,
	"sources" text[] NOT NULL,
	"bronze_ids" uuid[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gold_onedrive_documents_symbol" ON "gold"."onedrive_documents" USING btree ("symbol","modified_at");--> statement-breakpoint
CREATE INDEX "onedrive_files_symbol" ON "silver"."onedrive_files" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "onedrive_files_filing" ON "silver"."onedrive_files" USING btree ("filing_id");--> statement-breakpoint
CREATE INDEX "onedrive_folders_symbol" ON "silver"."onedrive_folders" USING btree ("symbol");