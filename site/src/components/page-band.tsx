import { WINNABLE, type ThreadPage } from "@/lib/winnable";

/**
 * The head of every inner page: a deep indigo band, the section name, one statement in large serif (after Altas's
 * statement block), and the page's line of the « play winnable games » thread, no icon before it (Thierry 2026-11-12).
 */
export function PageBand({ label, line, thread }: { label: string; line?: string; thread?: ThreadPage }) {
  return (
    <section className={`band${line ? "" : " band-short"}`}>
      <div className="wrap band-inner">
        <p className="band-label">{label}</p>
        {line && <h1 className="band-line">{line}</h1>}
        {thread && (
          <p className="band-thread">
            {WINNABLE[thread]}
          </p>
        )}
      </div>
    </section>
  );
}
