import { readPrivateFile } from "@/private/files";
import type { Source } from "../../types";

/** Author sources of a thesis (no console edit since 2026-11-19: nobody overrides the analysis by hand). */
export const CLAUDE_SOURCE = "claude";
export const NOTES_SOURCE = "watchlist";

/** His watchlist note wins over Claude's draft. */
export const THESIS_PRIORITY = [NOTES_SOURCE, CLAUDE_SOURCE] as const;
export const THESIS_MANUAL = [NOTES_SOURCE] as const;


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
