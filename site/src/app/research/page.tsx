import type { Metadata } from "next";
import { CoverStrip, CtaBand } from "@/components/blocks";
import { HeroField } from "@/components/hero-field";
import { PageBand } from "@/components/page-band";
import { Portal } from "@/components/portal";
import { CATEGORIES, DISCLAIMER, MARKETS } from "@/lib/model";
import { getPublications, getSubstackUrl } from "@/lib/queries";

export const metadata: Metadata = { title: "Research" };

const STEPS = [
  { title: "Idea released", body: "A defined thesis: why the price is wrong and what would prove us wrong." },
  { title: "Narrative watched", body: "Every filing and news item weighed against the story the market believes." },
  { title: "Ongoing coverage", body: "Material news, results and thesis progress." },
  { title: "Exit communicated", body: "Thesis played out, or broken." },
];

export default async function Research() {
  const [substackUrl, posts] = await Promise.all([getSubstackUrl(), getPublications()]);
  return (
    <>
      <PageBand label="Research" line="From overlooked companies to the right call." />

      <section className="section">
        <div className="wrap intro">
          <p className="intro-lead">The market prices stories. Long before a story breaks, the facts behind it are visible. We find the companies where the gap is widest and the story is about to turn.</p>
          <div className="intro-body">
            <dl className="stats-row">
              <div>
                <dt>{posts.length}</dt>
                <dd>Reports on the research platform</dd>
              </div>
              <div>
                <dt>{MARKETS.length}</dt>
                <dd>Markets in our coverage universe</dd>
              </div>
            </dl>
            <div className="prose">
              <p>Our coverage spans company deep dives, industry primers and shorter memos, long and short.</p>
              <p>Each published idea carries a defined thesis. Coverage continues through material developments, until the exit is communicated.</p>
              {substackUrl && (
                <a target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg" href={substackUrl}>
                  Open the research platform
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {posts.length > 0 && (
        <section className="cover-band">
          <div className="wrap cover-band-head">
            <h2>From the research platform</h2>
            <p>Each report opens on the research platform.</p>
          </div>
          <div className="wrap">
            <CoverStrip posts={posts} />
          </div>
        </section>
      )}

      <section className="section" id="portal">
        <div className="wrap">
          <h2 className="h-light">The research portal</h2>
          <p className="sub">Everything we have published, newest first. Point at a report to see it.</p>
          <Portal posts={posts} />
          <p className="disclaimer">{DISCLAIMER}</p>
        </div>
      </section>

      <section className="section">
        <div className="wrap triple">
          <h2 className="h-light stack">
            Small caps.
            <br />
            Overlooked markets.
          </h2>
          <div className="prose">
            <p>Ideas come from wherever the market is least efficient: under-covered markets in Asia, smaller companies big funds cannot buy, turnarounds investors have given up on.</p>
            <p>The portfolio stays concentrated, two to four names, long and short. Only the highest-conviction ideas make it.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="h-light">What we publish</h2>
          <p className="sub">Every report on the research platform belongs to one of three shelves.</p>
          <dl className="shelf-rows">
            {CATEGORIES.map((c) => (
              <div key={c.key}>
                <dt>{c.title}</dt>
                <dd>{c.body}</dd>
              </div>
            ))}
          </dl>
          <p className="caption left">The platform also carries short notes on Substack and X between reports.</p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="h-light">Our investment framework</h2>
          <p className="lead">Most research looks at one side of a stock and misses the trade.</p>
          <p className="lead">A great business at a fair price is not a trade. A broken story on a cheap business can be. Price and value both have to be read.</p>
          <div className="framework">
            <div className="fw-price">
              <p className="fw-kicker">The narrative</p>
              <h3>Market price</h3>
              <p>What the market believes today. Narratives can feed themselves for a long time, then crack.</p>
            </div>
            <div className="fw-gap" aria-hidden="true">
              <span>Gap</span>
            </div>
            <div className="fw-value">
              <p className="fw-kicker">The business</p>
              <h3>Fundamental value</h3>
              <p>What the company is worth if the plan works: normalized earnings and comparable companies, converted to a share price.</p>
            </div>
          </div>
          <p className="framework-foot">We take a position when the two disagree and the story starts to turn.</p>
        </div>
      </section>

      <section className="section grey split">
        <div className="wrap split-grid reverse">
          <div className="dark-panel">
            <HeroField plain seed="value-chain" clusters={5} perCluster={7} className="panel-field" />
            <div className="panel-labels" aria-hidden="true">
              {["Materials", "Equipment", "Chips", "Hardware", "Services"].map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
          </div>
          <div className="prose">
            <h2 className="h-bold">Following the value chain</h2>
            <p>The best ideas come from knowing one industry well, then moving fast along its value chain: when demand rises for chips, who ships more wafer carriers?</p>
            <p>Each company we cover is a dot. The links between them are where a signal shows up first.</p>
            <ul className="process">
              <li>
                <strong>Filter and shortlist.</strong> Thematic and industry screens over the markets we cover.
              </li>
              <li>
                <strong>Filings and diligence.</strong> Five years of core filings, results and management calls per company.
              </li>
              <li>
                <strong>Narrative check.</strong> Every news item and result weighed against the story the market believes.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="h-light">From identification to exit, every step is communicated</h2>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="step-n">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <CtaBand title="See the research at work" body="Explore the portfolio built from this coverage, and its performance this year." href="/portfolio" cta="View the portfolio" />
    </>
  );
}
