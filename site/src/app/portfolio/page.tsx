import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "@/components/blocks";
import { DarkChart } from "@/components/dark-chart";
import { PageBand } from "@/components/page-band";
import { formatDate, TRACK_RECORD } from "@/lib/model";
import { getSubstackUrl } from "@/lib/queries";

export const metadata: Metadata = { title: "Portfolio" };

const SNAPSHOT = [
  { big: `+${TRACK_RECORD.ytdPct}%`, small: `Year to date, as of ${formatDate(TRACK_RECORD.asOf)}*` },
  { big: "2 - 4", small: "Names held at a time" },
  { big: "Long and short", small: "Both sides of the narrative" },
  { big: "Selective", small: "Highest-conviction ideas only" },
  { big: "Small and mid caps", small: "In under-covered markets" },
];

export default async function Portfolio() {
  const substackUrl = await getSubstackUrl();
  return (
    <>
      <PageBand label="Portfolio" line="Our research, expressed in a concentrated portfolio." substackUrl={substackUrl} />

      <section className="section grey tight">
        <div className="wrap cards-2">
          <div className="card">
            <h2 className="h-light">The Duality Portfolio</h2>
            <p>Our concentrated long/short book.</p>
            <a href="#performance" className="link-arrow">
              View performance below ↓
            </a>
          </div>
          <div className="card">
            <h2 className="h-light">The Research Behind It</h2>
            <p>Every position starts as a published report.</p>
            <Link href="/research#portal" className="link-arrow">
              Open the research portal →
            </Link>
          </div>
        </div>
      </section>

      <section className="section" id="performance">
        <div className="wrap split-grid">
          <div className="prose">
            <h2 className="h-bold">The Duality Portfolio</h2>
            <p className="lead">The portfolio of Duality Asset Management, the fund Thierry Matin runs with its own capital, holds the highest-conviction ideas from this research.</p>
            <p>It stays concentrated: two to four names at a time, long and short. Every position can be traced back to a published thesis, and to its exit.</p>
          </div>
          <DarkChart
            title="Year-to-date return, %"
            legend={`Return year to date, as of ${formatDate(TRACK_RECORD.asOf)}`}
            bars={[
              { label: "Duality", value: TRACK_RECORD.ytdPct },
              { label: TRACK_RECORD.benchmark, value: TRACK_RECORD.benchmarkPct, muted: true },
            ]}
            format={(v) => `${Math.round(v * 10) / 10}%`}
            source="Source: Thierry Matin, published on Analysis Paralysis"
          />
        </div>
      </section>

      <section className="section">
        <div className="wrap snapshot-grid">
          <div>
            <h2 className="h-bold">Strategy Snapshot</h2>
            <dl className="snapshot">
              {SNAPSHOT.map((s) => (
                <div key={s.small}>
                  <dt>{s.big}</dt>
                  <dd>{s.small}</dd>
                </div>
              ))}
            </dl>
            <a target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-lg" href={TRACK_RECORD.sourceUrl}>
              Read the performance update →
            </a>
          </div>
          <p className="footnote">*{TRACK_RECORD.note} Investing involves risk, including the loss of capital. Dualis Research is not a registered investment adviser.</p>
        </div>
      </section>

      <CtaBand title="Explore Our Research" body="The reports behind every position, from first idea to exit." href="/research" cta="View the research page" substackUrl={substackUrl} />
    </>
  );
}
