import { pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/**
 * App state written by the console for a signed-in person (not research data, so outside bronze/silver/gold).
 * Keyed on the Clerk user id, so it follows the account across devices.
 */
export const app = pgSchema("app");

/**
 * Thierry's private input files (watchlist, first-draft theses, positions, outreach drafts, targets doc), keyed on the
 * path they had in the repo (`data/watchlist.json`). The repo is public: these never live in git. Written by
 * `pnpm private:push <folder>`; collectors read them through `src/private/files.ts`.
 */
export const privateFiles = app.table("private_files", {
  path: text("path").primaryKey(),
  content: text("content").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
