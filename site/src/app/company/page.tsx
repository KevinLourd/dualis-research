import type { Metadata } from "next";
import { CtaBand, TrustCards } from "@/components/blocks";
import { Constellation } from "@/components/constellation";
import { BothWaysFigure, NarrativeFigure } from "@/components/figures";
import { PageBand } from "@/components/page-band";
import { BEST_CALLS, BEST_CALLS_MIN_RETURN, BRAND, formatMonth, MARKETS } from "@/lib/model";
import { getPublications } from "@/lib/queries";

export const metadata: Metadata = { title: "Company" };

export default async function Company() {
  const posts = await getPublications();
  const calls = posts.filter((p) => p.category === "coverage");
  return (
    <>
      <PageBand label="Company" line="Equity research on the companies few analysts follow." />

      <section className="section split">
        <div className="wrap split-grid">
          <div className="prose">
            <h2 className="h-bold">Small and mid caps, read closely</h2>
            <p className="lead">{BRAND} covers listed companies that few analysts follow. We look where big funds cannot buy, and where the price has drifted far from what the business is worth.</p>
          </div>
          <Constellation seed="company-chain" width={560} height={380} clusters={5} perCluster={8} />
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="h-bold">Why readers trust the work</h2>
          <TrustCards />
        </div>
      </section>

      <section className="section split">
        <div className="wrap split-grid reverse">
          <div className="figure-wrap">
            <NarrativeFigure />
          </div>
          <div className="prose">
            <h2 className="h-bold">Play winnable games</h2>
            <p>The best odds sit where fewer eyes look: under-covered markets in Asia, small caps the large funds cannot own, names the market has murdered or loved without sense.</p>
            <p>Prices follow narratives. Value follows the business. When the two drift apart and the story starts to turn, there is a trade.</p>
          </div>
        </div>
      </section>

      <section className="section split">
        <div className="wrap split-grid">
          <div className="prose">
            <h2 className="h-bold">Research that runs in both directions</h2>
            <p>We go long when a bad narrative is cracking, with the price still below fundamental value. We exit once it is priced fairly.</p>
            <p>We go short when the price sits above fundamental value on a story that is starting to break. Then we wait for the catalyst.</p>
          </div>
          <div className="figure-wrap">
            <BothWaysFigure />
          </div>
        </div>
      </section>

      <section className="section deep">
        <div className="wrap">
          <h2 className="h-bold">Calls on the record</h2>
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
          </ol>
        </div>
      </section>

      <section className="section split">
        <div className="wrap split-grid">
          <div className="prose">
            <h2 className="h-bold">From Astana, across eight markets</h2>
            <p>{BRAND} is based in Astana, Kazakhstan. Coverage spans small and mid caps across Asia, North America and Europe.</p>
            <p>For the highest-conviction ideas, we meet management, on site when it matters.</p>
          </div>
          <ul className="markets">
            {MARKETS.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      </section>

      <CtaBand title="Read the research" body="Every report, newest first, with the record behind each call." href="/research" cta="Open the research" />
    </>
  );
}
