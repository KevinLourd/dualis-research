import { readPrivateFile } from "@/private/files";
import type { Source } from "../../types";

/** Author sources of a thesis. `console` = an edit or accept Thierry made in the console (written by the app). */
export const CLAUDE_SOURCE = "claude";
export const NOTES_SOURCE = "watchlist";
export const CONSOLE_SOURCE = "console";

/** Thierry's word wins over Claude's; his console edits win over his older watchlist note. */
export const THESIS_PRIORITY = [CONSOLE_SOURCE, NOTES_SOURCE, CLAUDE_SOURCE] as const;
export const THESIS_MANUAL = [CONSOLE_SOURCE, NOTES_SOURCE] as const;


/** Thierry's thesis note for the ticker in data/watchlist.json (null when he wrote none). */
export const watchlistNotes: Source = {
  name: NOTES_SOURCE,
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol, ctx) {
    const file = JSON.parse(await readPrivateFile(ctx.db, "data/watchlist.json")) as { thesis_notes?: Record<string, string> };
    return { request: { file: "data/watchlist.json", symbol }, httpStatus: null, payload: { note: file.thesis_notes?.[symbol] ?? null } };
  },
};
