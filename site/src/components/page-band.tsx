/**
 * The head of every inner page: a pale indigo band, the section name, then one statement in large serif (after
 * Altas's statement block, away from Aurelion's navy band). Social links live in the footer.
 */
export function PageBand({ label, line }: { label: string; line?: string }) {
  return (
    <section className={`band${line ? "" : " band-short"}`}>
      <div className="wrap band-inner">
        <p className="band-label">{label}</p>
        {line && <h1 className="band-line">{line}</h1>}
      </div>
    </section>
  );
}
