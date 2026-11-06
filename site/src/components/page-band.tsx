import { Social } from "./social";

/** The navy band that opens every inner page: section label, one line, social row (Aurelion's page head). */
export function PageBand({ label, line, substackUrl }: { label: string; line?: string; substackUrl: string | null }) {
  return (
    <section className={`band${line ? "" : " band-short"}`}>
      <div className="wrap band-inner">
        <div>
          <p className="band-label">{label}</p>
          {line && <h1 className="band-line">{line}</h1>}
        </div>
        <Social substackUrl={substackUrl} />
      </div>
    </section>
  );
}
