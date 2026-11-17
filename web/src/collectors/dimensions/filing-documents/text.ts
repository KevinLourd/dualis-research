/**
 * Plain text out of a filing, page by page, and the check that a quote is printed on a page. Pure: the console reads
 * `isPrintedOn` / `findQuote` too.
 */

/** A page longer than this is cut (a page is read whole by a judge; a 10-K table dump can run to 100 KB). */
export const MAX_PAGE_CHARS = 20_000;
/** An HTML or XML document with no page breaks is cut in pages of about this size, at a paragraph. */
export const CHUNK_CHARS = 4_000;
/** A document past this many pages keeps its first ones only. */
export const MAX_PAGES = 500;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", yen: "¥", euro: "€", pound: "£" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Postgres text and jsonb refuse NUL; control characters are noise. Spaces collapsed, line breaks kept. */
export function cleanText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t 　]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const BLOCK = /<\/?(p|div|br|tr|li|h[1-6]|table|section|article|ul|ol|title|P|TABLE|TR|TITLE|SECTION-\d|LIBRARY|BODY|PGBRK)\b[^>]*>/gi;

/** HTML (or DART / EDINET XML) to text: scripts, styles and hidden iXBRL headers dropped, blocks on their own line. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ix:header\b[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<td\b[^>]*>/gi, " ")
    .replace(BLOCK, "\n")
    .replace(/<[^>]+>/g, "");
  return cleanText(decodeEntities(text));
}

/** An HTML filing's own pages: SEC filings mark each printed page with a CSS page break. */
const PAGE_BREAK = /<[^>]+page-break-(?:before|after)\s*:\s*always[^>]*>/gi;

/** Cuts a long text in pages of about `size` characters, at a blank line, else a line, else a space. */
export function chunk(text: string, size = CHUNK_CHARS): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > size) {
    const window = rest.slice(0, size);
    const cut = [window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" ")].find((i) => i > size / 2) ?? size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** The pages of an HTML / XML document: its own page breaks when it has them, else chunks. Empty pages dropped. */
export function htmlPages(html: string): string[] {
  const parts = html.split(PAGE_BREAK);
  const pages = (parts.length > 1 ? parts.map(htmlToText) : chunk(htmlToText(html))).filter((p) => p.length > 0);
  // A page break document can still hold a huge page (a whole note in one block): cut it like a chunked one.
  return pages.flatMap((p) => (p.length > MAX_PAGE_CHARS ? chunk(p) : [p]));
}

/** Final shape of a document's pages: cleaned, capped in size and count. PDF pages keep their numbers (empty ones too). */
export function finalPages(pages: string[]): string[] {
  return pages.slice(0, MAX_PAGES).map((p) => cleanText(p).slice(0, MAX_PAGE_CHARS));
}

/**
 * The comparable form of a text: Unicode compatibility forms (full-width digits), one kind of quote and dash, lower
 * case, no whitespace at all (PDF text breaks lines and spaces anywhere, like `pdf-extract`'s check).
 */
export function flatten(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** A quote shorter than this proves nothing (« revenue », « 10% »). */
export const MIN_QUOTE_CHARS = 12;

/** True when `quote` is printed on `pageText` (whitespace, case, quote and dash styles aside). */
export function isPrintedOn(pageText: string, quote: string): boolean {
  const q = flatten(quote.replace(/^[\s"'“”‘’«»]+|[\s"'“”‘’«»]+$/g, ""));
  return q.length >= MIN_QUOTE_CHARS && flatten(pageText).includes(q);
}

/**
 * Where `quote` sits in `text` as printed: [start, end) offsets in the ORIGINAL text, so the console can highlight it.
 * Null when it is not on the page.
 */
export function findQuote(text: string, quote: string): [number, number] | null {
  const q = flatten(quote.replace(/^[\s"'“”‘’«»]+|[\s"'“”‘’«»]+$/g, ""));
  if (q.length < MIN_QUOTE_CHARS) return null;
  // Flatten character by character, remembering where each flat character came from.
  let flat = "";
  const from: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const f = flatten(ch);
    for (let k = 0; k < f.length; k++) from.push(i);
    flat += f;
    i += ch.length;
  }
  const at = flat.indexOf(q);
  if (at < 0) return null;
  const last = from[at + q.length - 1];
  return [from[at], last + String.fromCodePoint(text.codePointAt(last)!).length];
}
