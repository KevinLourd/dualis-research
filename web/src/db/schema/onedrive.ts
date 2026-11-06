import { bigint, boolean, index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app } from "./app";
import { gold } from "./gold";
import { silver } from "./silver";

/**
 * Thierry's research folder in his OneDrive (work account), through Microsoft Graph.
 * - app.onedrive_connection: his sign-in (device-code login started from Settings) and the folder he picked.
 * - onedrive dimension (read): bronze = every Graph listing; silver = one row per company folder and per file;
 *   gold.onedrive_documents = what the thesis research and the console read.
 * - onedrive-filings dimension (write): creates the company folder when he has none, a "Filings (Dualis)" subfolder
 *   in each, and uploads every new core filing there. Never deletes, never overwrites, never writes elsewhere.
 */

/** One row (id "thierry"): the Microsoft sign-in and the research root. The refresh token is AES-GCM encrypted. */
export const onedriveConnection = app.table("onedrive_connection", {
  id: text("id").primaryKey(),
  /** Pending device-code login: the encrypted device code, the code he types, where he types it, until when. */
  pendingDeviceCode: text("pending_device_code"),
  pendingUserCode: text("pending_user_code"),
  pendingVerificationUri: text("pending_verification_uri"),
  pendingExpiresAt: timestamp("pending_expires_at", { withTimezone: true }),
  /** The signed-in Microsoft account (e.g. thierry@example.com). */
  account: text("account"),
  refreshToken: text("refresh_token"),
  scope: text("scope"),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  tokenRefreshedAt: timestamp("token_refreshed_at", { withTimezone: true }),
  /** The research root he picked: one subfolder per company. */
  rootItemId: text("root_item_id"),
  rootPath: text("root_path"),
  /** Last sign-in or token error, shown on Settings until the next success. */
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type OnedriveConnection = typeof onedriveConnection.$inferSelect;

/** One company folder under the research root. Natural key: the Graph item id. */
export const onedriveFolders = silver.table(
  "onedrive_folders",
  {
    itemId: text("item_id").primaryKey(),
    /** The watchlist ticker this folder belongs to, null when no ticker matches its name. */
    symbol: text("symbol"),
    name: text("name").notNull(),
    webUrl: text("web_url"),
    /** How the ticker was tied: "symbol" | "name" | "alias" | "created" (we created it for the ticker). */
    matchedBy: text("matched_by"),
    /** Last time its content was listed in full: a file not seen since then was moved or deleted by Thierry. */
    listedAt: timestamp("listed_at", { withTimezone: true }),
    /** "onedrive" (listed), "dualis" (we created it). */
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("onedrive_folders_symbol").on(t.symbol)],
);
export type SilverOnedriveFolder = typeof onedriveFolders.$inferSelect;

/** One file inside a company folder (any depth). Natural key: the Graph item id. */
export const onedriveFiles = silver.table(
  "onedrive_files",
  {
    itemId: text("item_id").primaryKey(),
    folderItemId: text("folder_item_id").notNull(),
    symbol: text("symbol"),
    name: text("name").notNull(),
    /** Path under the company folder, e.g. "Filings (Dualis)/2026-11-03 10-Q.htm". */
    path: text("path").notNull(),
    kind: text("kind").notNull(),
    size: bigint("size", { mode: "number" }),
    mimeType: text("mime_type"),
    modifiedAt: timestamp("modified_at", { withTimezone: true }),
    webUrl: text("web_url"),
    /** Text of a small note (.txt / .md), for the thesis research. */
    excerpt: text("excerpt"),
    /** The silver.filings row we uploaded it from, when we wrote it. */
    filingId: uuid("filing_id"),
    /** "onedrive" (listed), "dualis" (we uploaded it). */
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("onedrive_files_symbol").on(t.symbol), index("onedrive_files_filing").on(t.filingId)],
);
export type SilverOnedriveFile = typeof onedriveFiles.$inferSelect;

/** Per ticker: every document of its research folder, his and ours. What the thesis research reads. */
export const onedriveDocuments = gold.table(
  "onedrive_documents",
  {
    itemId: text("item_id").primaryKey(),
    symbol: text("symbol").notNull(),
    folderName: text("folder_name").notNull(),
    path: text("path").notNull(),
    name: text("name").notNull(),
    /** filing | model | transcript | presentation | note | other */
    kind: text("kind").notNull(),
    size: bigint("size", { mode: "number" }),
    modifiedAt: timestamp("modified_at", { withTimezone: true }),
    webUrl: text("web_url"),
    excerpt: text("excerpt"),
    /** True for a filing we saved into "Filings (Dualis)". */
    savedByDualis: boolean("saved_by_dualis").notNull(),
    sources: text("sources").array().notNull(),
    rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gold_onedrive_documents_symbol").on(t.symbol, t.modifiedAt)],
);
export type GoldOnedriveDocument = typeof onedriveDocuments.$inferSelect;
