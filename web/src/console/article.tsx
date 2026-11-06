import { DriverExhibit } from "@/console/driver-chart";
import type { DraftChart } from "@/db/schema/content";

/**
 * Renders a draft article's markdown the way Substack lays it out (headings, paragraphs, bullets, bold, italic) and
 * puts each [EXHIBIT n] marker's chart in place. A tiny renderer on purpose: drafts use only these few marks.
 */

function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith("**") ? <strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong> : <em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** `renderExhibit` draws exhibit n when the charts are not draft charts (a Research Report's gold.exhibits). */
export function ArticleBody({ markdown, charts = [], renderExhibit }: { markdown: string; charts?: DraftChart[]; renderExhibit?: (n: number) => React.ReactNode }) {
  // Exhibit markers always stand alone, even when a stored draft has one inside a paragraph.
  const blocks = markdown
    .replace(/\s*(\[EXHIBIT \d+\])\s*/g, "\n\n$1\n\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  return (
    <div className="flex flex-col gap-5 text-[17px] leading-[1.7] text-kumo-default" style={{ fontFamily: "Newsreader, Georgia, 'Times New Roman', serif" }}>
      {blocks.map((b, i) => {
        const exhibit = b.match(/^\[EXHIBIT (\d+)\]$/);
        if (exhibit) {
          const n = Number(exhibit[1]);
          if (renderExhibit) return <div key={i} className="my-2">{renderExhibit(n)}</div>;
          const c = charts[n - 1];
          return c ? (
            <div key={i} className="my-2">
              <DriverExhibit number={n} title={c.title} unit={c.unit} period={c.period} points={c.points} sources={c.sources} />
            </div>
          ) : null;
        }
        if (b.startsWith("### ")) return <h3 key={i} className="mt-2 text-xl font-semibold text-kumo-strong">{inline(b.slice(4), `h${i}`)}</h3>;
        if (b.startsWith("## ")) return <h2 key={i} className="mt-4 text-2xl font-bold text-kumo-strong">{inline(b.slice(3), `h${i}`)}</h2>;
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={i} className="ml-6 list-disc space-y-1">
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*] /, ""), `l${i}-${j}`)}</li>)}
            </ul>
          );
        }
        return <p key={i}>{inline(lines.join(" "), `p${i}`)}</p>;
      })}
    </div>
  );
}
