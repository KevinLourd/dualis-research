import type { DraftInputs } from "@/db/schema/content";

/** Pure prompt + output handling for draft generations, shared by the collector, the console and tests. */

export const DRAFT_FORMATS = ["x-post", "linkedin-post", "substack-note", "substack-article"] as const;
export type DraftFormat = (typeof DRAFT_FORMATS)[number];

/**
 * The formats an Idea is scored and offered for. Thierry writes the weekly article himself (call 2026-11-06: « that's
 * where a lot of my time is going to go »), so drafts are for Notes and posts; an article request already made still shows.
 */
export const PROPOSED_FORMATS = ["substack-note", "x-post", "linkedin-post"] as const satisfies readonly DraftFormat[];

/** Short channels end with this line; the Substack article ends with the template's full disclaimer. */
export const SHORT_DISCLAIMER = "Not investment advice.";
export const ARTICLE_DISCLAIMER =
  "Not investment advice. For information only. The author may hold positions in the securities discussed.";

export const X_LIMIT = 280;

export const PROMPT_VERSION = "drafts-v8";

export const GAME = [
  "You write for an independent equity research writer (Thierry Matin, small and mid caps, long/short, eight markets). Brand: Dualis Research.",
  "The game: grow paid Substack subscribers. The reader is a self-directed, experienced small-cap investor who reads filings and pays for ideas the big funds miss.",
  "A post earns a follow when it gives ONE sharp, dated fact and says, bluntly, what it means for holders, so readers feel they must act before the market catches up.",
  "The post tells ONE Idea, given below with the evidence behind it. One claim only: what just happened and why the price is wrong now. Pick the single strongest fact, drop the rest.",
  "Tone: alarm. Sound the warning a sharp analyst sends a friend who holds the stock: urgent, direct, certain. Name the danger or the missed opportunity in plain words and say the market has not priced it.",
  "Plain words: subject, verb, object. Short sentences. No accounting jargon a retail investor must decode (say \"profit for shareholders\", never \"income available to common\"). No hedging: never \"in my view\", \"not proven yet\", \"it remains to be seen\", never a \"but\" that walks the claim back.",
  "An Idea is not always a turn in the story: an update on the company is worth a post too. Say what is new and why a holder must care today.",
  "Never write a disclaimer, it is added after you. Never invent a figure that is not in the inputs. Never an em dash or en dash, no hashtags, no hype words, no emoji except the opening siren.",
  "Breaking-news style: open with \"🚨 \" then the company's short name and a colon (\"🚨 CareCloud: \", never the legal name like \"CareCloud Inc.\", never the ticker), then the alarm with its number.",
  "Write in the voice of the account below, following its style guide. When the guide and these rules disagree, these rules win.",
].join("\n");

export const FORMAT_RULES: Record<DraftFormat, string> = {
  "x-post": [
    "Format: one X post, much smaller than a Note: one or two short sentences, at most 160 characters, the ticker as a $cashtag once after the opening.",
    "Lead with the alarm and its number. The chart attached is a sober exhibit with no news card and no signal on it, so the words carry the breaking news: name its source when it is a big publisher (\"per Reuters\"), and the live signal when there is one (\"Shares 28% under fair value\"). Answer with the post text only.",
  ].join("\n"),
  "linkedin-post": "Format: one LinkedIn post, 600 to 1200 characters, short paragraphs, ends with one question to the reader. Answer with the post text only.",
  "substack-note": [
    "Format: one Substack Note = one small paragraph with a chart. The chart of the Idea (price against fair value, or the figure the Idea rests on) is attached under the text, so never describe it point by point.",
    "Write ONE paragraph of 2 or 3 short sentences, 150 to 300 characters, no line breaks, no headings, no list. It reads as a warning, never a report.",
    "Sentence 1 = the alarm with its number. Sentence 2 = why the market has it wrong. Optional sentence 3 = what holders should watch next.",
    "Answer with the note text only.",
  ].join("\n"),
  "substack-article": [
    "Format: one full Substack article, 900 to 1500 words, in this section order with these exact headings: ## 1. The business, ## 2. What the market believes, ## 3. What changed, ## 4. Bull vs Bear, ## 5. What would prove us wrong.",
    "Title states a view with its figures (a claim, never a topic), like \"20% Recurring Revenue Growth, Record Customer Wins, Down 56%\". Subtitle in one line.",
    "Use the exhibits offered: put [EXHIBIT <id>] on its own line where a chart helps, at most 3, each one an id from the list. The id is for that marker only: in the text call them Exhibit 1, 2, 3 in order of appearance. Each exhibit prints its own title and source line under it, so never write a source line for it.",
    "Where a figure is missing, write what we would need to know, never a guess.",
    'Answer with JSON only, no prose, no code fence: {"title": "...", "subtitle": "...", "body": "<markdown>"}',
  ].join("\n"),
};

export function draftSystem(format: DraftFormat, voiceGuide: string | null, accountName: string | null): string {
  return [
    GAME,
    "",
    `Account: ${accountName ?? "not chosen yet"}`,
    voiceGuide ? `Style guide of this account:\n${voiceGuide}` : "No style guide yet: write in a sharp, urgent research voice.",
    "",
    FORMAT_RULES[format],
  ].join("\n");
}

/** What the writer gets beside the Idea: the ticker's story and the evidence the Idea rests on, in words. */
export type IdeaContext = {
  narrative: string | null;
  signal: string | null;
  fairValue: string | null;
  evidence: { headline: string; publisher: string | null; day: string; why: string | null; url: string | null }[];
  drivers: { title: string; summary: string | null }[];
  signalChanges: { label: string; note: string | null }[];
};

export function draftPrompt(inputs: DraftInputs, ctx: IdeaContext, exhibits: { id: string; label: string }[] = []): string {
  const idea = inputs.idea;
  const lines = [
    `Ticker: ${inputs.symbol}${inputs.companyName ? ` (${inputs.companyName})` : ""}`,
    "",
    `Idea: ${idea?.title ?? ""}`,
    `Why now: ${idea?.angle ?? ""}`,
    "",
    `What the market believes: ${ctx.narrative ?? "not written yet"}`,
    ctx.signal ? `Signal: ${ctx.signal}` : "",
    ctx.fairValue ? `Fair value: ${ctx.fairValue}` : "",
    ...(ctx.signalChanges.length ? ["", "Signal changes:", ...ctx.signalChanges.map((c) => `- ${c.label}${c.note ? `: ${c.note}` : ""}`)] : []),
    ...(ctx.evidence.length
      ? ["", "Evidence:", ...ctx.evidence.map((e) => `- ${e.day} ${e.publisher ?? ""}: ${e.headline}${e.why ? `. ${e.why}` : ""}${e.url ? ` (${e.url})` : ""}`)]
      : []),
    ...(ctx.drivers.length ? ["", "Narrative drivers (why the market holds its story):", ...ctx.drivers.map((d) => `- ${d.title}${d.summary ? `: ${d.summary}` : ""}`)] : []),
    exhibits.length ? ["", "Exhibits you may use:", ...exhibits.map((x) => `- ${x.id}: ${x.label}`)].join("\n") : "",
  ];
  return lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n").trim();
}

export type GeneratedDraft = { title: string | null; body: string; exhibitIds: string[] };

/** Removes em and en dashes (banned in published copy) without touching hyphens. */
export function stripDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",");
}

/**
 * Reads one generation's answer. Short formats are the text itself; the article is JSON with markdown and
 * [EXHIBIT id] markers, kept only for ids we offered. Throws with the reason when the article is not that JSON.
 */
export function parseGeneration(format: DraftFormat, text: string, offeredIds: string[] = []): GeneratedDraft {
  if (format !== "substack-article") {
    const body = stripDashes(text.trim());
    if (!body) throw new Error("answer is empty");
    return { title: null, body, exhibitIds: [] };
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("answer holds no JSON object");
  const obj = JSON.parse(text.slice(start, end + 1)) as { title?: unknown; subtitle?: unknown; body?: unknown };
  const str = (v: unknown, name: string) => {
    if (typeof v !== "string" || !v.trim()) throw new Error(`answer has no ${name}`);
    return stripDashes(v.trim());
  };
  const title = str(obj.title, "title");
  const subtitle = str(obj.subtitle, "subtitle");
  let body = str(obj.body, "body");
  const exhibitIds: string[] = [];
  // A marker may sit inside a paragraph: every one becomes its own block. Unknown ids are dropped; a bare number
  // means the n-th offered exhibit.
  body = body.replace(/\[EXHIBIT ([^\]]+)\]/g, (_m, id: string) => {
    let key = id.trim();
    if (!offeredIds.includes(key) && /^\d+$/.test(key) && offeredIds[Number(key) - 1]) key = offeredIds[Number(key) - 1];
    if (!offeredIds.includes(key)) return "";
    if (!exhibitIds.includes(key)) exhibitIds.push(key);
    return `\n\n[EXHIBIT ${exhibitIds.indexOf(key) + 1}]\n\n`;
  });
  // An exhibit id never reaches the reader: "Exhibit E.TO:11" reads "Exhibit 2".
  exhibitIds.forEach((id, i) => {
    body = body.split(`Exhibit ${id}`).join(`Exhibit ${i + 1}`);
  });
  body = body.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n");
  return { title, body: `*${subtitle}*\n\n${body.replace(/\n{3,}/g, "\n\n")}`, exhibitIds };
}

/** The text as it will be published: every piece ends with the not-investment-advice line. */
export function withDisclaimer(format: string, body: string): string {
  return `${body}\n\n${format === "substack-article" ? ARTICLE_DISCLAIMER : SHORT_DISCLAIMER}`;
}

/** One-click publishing at $0: X post intent, LinkedIn share box, Substack has no API (copy and paste). */
export function publishLink(format: string, text: string): { label: string; href: string } | null {
  if (format === "x-post") return { label: "Post on X", href: `https://x.com/intent/post?text=${encodeURIComponent(text)}` };
  if (format === "linkedin-post") {
    return { label: "Share on LinkedIn", href: `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}` };
  }
  if (format === "substack-note") return { label: "Open Substack Notes", href: "https://substack.com/notes" };
  if (format === "substack-article") return { label: "Open Substack editor", href: "https://substack.com/home" };
  return null;
}

export const FORMAT_LABEL: Record<string, string> = {
  "x-post": "X post",
  "linkedin-post": "LinkedIn post",
  "substack-note": "Substack Note",
  "substack-article": "Substack article",
};
