import { type OutreachStatus, outreachStatusValues } from "@/db/schema/growth";
/** One drafted message in data/outreach/*.md. */
export type OutreachDraft = {
  handle: string;
  publicationName: string;
  hook: string | null;
  ask: string | null;
  body: string;
  rank: number;
};

const HEADING = /^##\s+(\d+)\.\s+(.+)$/;

/**
 * Reads Claude's outreach file: one `## N. Publication — Author (@handle) — 16K` section per author, its
 * `- Hook:` / `- Ask:` lines, and the message as a blockquote. A section with no handle or no message is an error
 * (the file is ours: a malformed one must fail loud, not drop a target).
 */
export function parseOutreachMarkdown(text: string): OutreachDraft[] {
  const out: OutreachDraft[] = [];
  const lines = text.split(/\r?\n/);
  let cur: { rank: number; heading: string; hook: string | null; ask: string | null; quote: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const handle = cur.heading.match(/\(@([A-Za-z0-9_.-]+)\)/)?.[1];
    if (!handle) throw new Error(`outreach section "${cur.heading}" has no (@handle)`);
    const body = cur.quote.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!body) throw new Error(`outreach section "${cur.heading}" has no message (blockquote)`);
    const publicationName = cur.heading.split(/\s+[—–-]\s+|\s+\(@/)[0].trim();
    out.push({ handle, publicationName, hook: cur.hook, ask: cur.ask, body, rank: cur.rank });
    cur = null;
  };
  for (const line of lines) {
    const h = line.match(HEADING);
    if (h) {
      flush();
      cur = { rank: Number(h[1]), heading: h[2].trim(), hook: null, ask: null, quote: [] };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("## ") || line.startsWith("# ")) {
      flush();
      continue;
    }
    const meta = line.match(/^-\s+(Hook|Ask):\s*(.+)$/);
    if (meta) {
      if (meta[1] === "Hook") cur.hook = meta[2].trim();
      else cur.ask = meta[2].trim();
      continue;
    }
    if (line.startsWith(">")) cur.quote.push(line.replace(/^>\s?/, ""));
  }
  flush();
  return out;
}

/**
 * Contact column of docs/acquisition-targets.md, per Substack author handle (the last `@handle` of the Author
 * column): markdown links as they are, bare emails as mailto: links.
 */
export function parseTargetContacts(text: string): Map<string, { label: string; href: string }[]> {
  const out = new Map<string, { label: string; href: string }[]>();
  const lines = text.split(/\r?\n/);
  const header = lines.find((l) => l.startsWith("|") && /\|\s*Contact\s*\|/.test(l));
  if (!header) throw new Error("targets doc has no table with a Contact column");
  const cols = header.split("|").map((c) => c.trim());
  const authorCol = cols.findIndex((c) => c.startsWith("Author"));
  const contactCol = cols.indexOf("Contact");
  for (const line of lines.slice(lines.indexOf(header) + 1)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").map((c) => c.trim());
    const handle = [...(cells[authorCol] ?? "").matchAll(/@([A-Za-z0-9_.-]+)/g)].at(-1)?.[1];
    if (!handle) continue;
    const cell = cells[contactCol] ?? "";
    const contacts = [...cell.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((m) => ({ label: m[1], href: m[2] }));
    const withoutLinks = cell.replace(/\[[^\]]+\]\([^)]+\)/g, " ");
    for (const m of withoutLinks.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) contacts.push({ label: m[0], href: `mailto:${m[0]}` });
    out.set(handle, contacts);
  }
  return out;
}

/** data/growth/outreach-log.json: what Thierry said he did with which authors (fails loud on a bad entry). */
export function parseOutreachLog(payload: unknown): { at: Date; status: OutreachStatus; handles: string[] }[] {
  if (!Array.isArray(payload)) throw new Error("outreach log is not a list");
  return payload.map((e: { at?: unknown; status?: unknown; handles?: unknown }) => {
    const at = typeof e.at === "string" ? new Date(e.at) : null;
    if (!at || Number.isNaN(at.getTime())) throw new Error(`outreach log entry has no valid "at": ${JSON.stringify(e)}`);
    if (!outreachStatusValues.includes(e.status as OutreachStatus)) throw new Error(`outreach log entry has an unknown status: ${JSON.stringify(e)}`);
    if (!Array.isArray(e.handles) || e.handles.length === 0 || !e.handles.every((h) => typeof h === "string" && h)) {
      throw new Error(`outreach log entry has no handles: ${JSON.stringify(e)}`);
    }
    return { at, status: e.status as OutreachStatus, handles: e.handles as string[] };
  });
}

/** Kevin's readings of Thierry's count on the Substack dashboard. */
export function parseReadings(payload: unknown): { date: string; subscribers: number }[] {
  if (!Array.isArray(payload)) throw new Error("audience readings file is not a list");
  return payload.map((r: { date?: unknown; subscribers?: unknown }) => {
    if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || typeof r.subscribers !== "number") {
      throw new Error(`bad audience reading ${JSON.stringify(r)}`);
    }
    return { date: r.date, subscribers: r.subscribers };
  });
}
