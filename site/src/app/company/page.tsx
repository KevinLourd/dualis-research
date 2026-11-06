import type { Metadata } from "next";
import { CtaBand } from "@/components/blocks";
import { Constellation } from "@/components/constellation";
import { HeroField } from "@/components/hero-field";
import { BothWaysFigure, NarrativeFigure } from "@/components/figures";
import { PageBand } from "@/components/page-band";
import { BEST_CALLS, BEST_CALLS_MIN_RETURN, BRAND, formatMonth, MARKETS } from "@/lib/model";
import { getPublications, getSubstackUrl } from "@/lib/queries";

export const metadata: Metadata = { title: "Company" };

export default async function Company() {
  const [substackUrl, posts] = await Promise.all([getSubstackUrl(), getPublications()]);
  const calls = posts.filter((p) => p.category === "coverage");
  return (
    <>
      <PageBand label="Company" line={`${BRAND} is an independent equity research firm.`} substackUrl={substackUrl} />

      <section className="section split">
        <div className="wrap split-grid">
          <div className="prose">
            <h2 className="h-bold">A Focused Voice in Small and Mid Cap Equity Research</h2>
            <p className="lead">
              {BRAND} covers listed companies that few analysts follow. We look where big funds cannot buy and where the price has drifted far from what the business is worth.
            </p>
          </div>
          <Constellation seed="company-chain" width={560} height={380} clusters={5} perCluster={8} />
        </div>
      </section>

      <section className="section split">
        <div className="wrap split-grid reverse">
          <div className="figure-wrap">
            <NarrativeFigure />
          </div>
          <div className="prose">
            <h2 className="h-bold">Play Winnable Games</h2>
            <p>The best odds sit where fewer eyes look: under-covered markets in Asia, small caps the large funds cannot own, names the market has murdered or loved without sense.</p>
            <p>Prices follow narratives. Value follows the business. When the two drift apart and the story starts to turn, there is a trade.</p>
          </div>
        </div>
      </section>

      <section className="section grey split">
        <div className="wrap split-grid">
          <div className="prose">
            <h2 className="h-bold">Research That Runs in Both Directions</h2>
            <p>We go long when a bad narrative is cracking and a new one is inflecting, with the price still below fundamental value. We exit once it is priced fairly.</p>
            <p>We go short when the price sits above fundamental value on a story that is starting to break. Then we wait for the catalyst.</p>
            <p>Both sides come from the same work: the business, the numbers, and the narrative the market is paying for.</p>
          </div>
          <div className="figure-wrap">
            <BothWaysFigure />
          </div>
        </div>
      </section>

      <section className="section split">
        <div className="wrap split-grid">
          <div className="prose">
            <h2 className="h-bold">Active Research</h2>
            <p>Finding the idea is half the job. Every covered company is watched every day: filings, results, news and insider trades.</p>
            <p>When the facts move a thesis, readers hear it first. When a thesis has played out, or broken, we say so clearly.</p>
          </div>
          <div className="dark-panel">
            <HeroField plain seed="active-watch" clusters={4} perCluster={9} className="panel-field" />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap triple">
          <h2 className="h-bold stack">
            Independent.
            <br />
            Aligned.
            <br />
            Accountable.
          </h2>
          <div className="prose">
            <p>{BRAND} is not engaged in investment banking, corporate advisory or capital raising. Nothing competes with the research for attention.</p>
            <p>Revenue comes from readers who find the research worth paying for. Our performance is public.</p>
            <p>Thierry Matin may hold the ideas he writes about through Duality Asset Management, a fund that invests only its own capital.</p>
          </div>
        </div>
      </section>

      <section className="section grey">
        <div className="wrap">
          <h2 className="h-bold">Recent Track Record</h2>
          <p className="sub">
            Our best calls so far: {BEST_CALLS.map((c) => `${c.name} (${c.side.toLowerCase()})`).join(" and ")}, both above +{BEST_CALLS_MIN_RETURN}%.
          </p>
          <ol className="timeline">
            {calls.map((p) => (
              <li key={p.id}>
                <span className="tl-date">{formatMonth(p.publishedAt)}</span>
                <span className="tl-dot" aria-hidden="true" />
                <a target="_blank" rel="noopener noreferrer" href={p.url} className="tl-body">
                  <strong>{p.title}</strong>
                  {p.subtitle && <span>{p.subtitle}</span>}
                </a>
              </li>
            ))}
            {calls.length === 0 && <li className="tl-empty">The published calls appear here as they are filed.</li>}
          </ol>
        </div>
      </section>

      <section className="section split">
        <div className="wrap split-grid">
          <div className="prose">
            <h2 className="h-bold">Based in Astana. Global Coverage.</h2>
            <p>{BRAND} is based in Astana, Kazakhstan. Coverage spans small and mid caps across Asia, North America and Europe.</p>
            <p>For our highest-conviction ideas we meet management, on site when it matters.</p>
          </div>
          <ul className="markets">
            {MARKETS.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="wrap narrow center">
          <h2 className="h-bold">Global Distribution</h2>
          <p className="lead">Our research serves independent investors, professionals and anyone who wants to see what the market is missing.</p>
          <div className="platform-box">
            <h3>{BRAND} Platform</h3>
            <p>Our research is published as a subscription on Substack.</p>
            {substackUrl && (
              <a target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg stacked" href={substackUrl}>
                Read our research →<small>{new URL(substackUrl).host}</small>
              </a>
            )}
          </div>
        </div>
      </section>

      <CtaBand title="Explore Our Research" body="Our coverage, our method, and what subscribers receive." href="/research" cta="View the research page" substackUrl={substackUrl} />
    </>
  );
}
