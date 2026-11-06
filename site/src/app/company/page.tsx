import type { Metadata } from "next";
import { CallsBoard, CtaBand, TrustCards } from "@/components/blocks";
import { Constellation } from "@/components/constellation";
import { BothWaysFigure, NarrativeFigure } from "@/components/figures";
import { PageBand } from "@/components/page-band";
import { BEST_CALLS_MIN_RETURN, BRAND, MARKETS } from "@/lib/model";
import { getPublications } from "@/lib/queries";

export const metadata: Metadata = { title: "Company" };

export default async function Company() {
  const posts = await getPublications();
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
          <p className="proof-kicker">Track record</p>
          <h2 className="calls-head">Two calls, both above +{BEST_CALLS_MIN_RETURN}%. One long, one short.</h2>
          <CallsBoard posts={posts} />
        </div>
      </section>

      <section className="section split">
        <div className="wrap split-grid">
          <div className="prose">
            <h2 className="h-bold">Global coverage</h2>
            <p>Small and mid caps across Asia, North America and Europe. For the highest-conviction ideas, we meet management.</p>
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
