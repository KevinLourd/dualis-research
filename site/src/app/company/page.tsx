import type { Metadata } from "next";
import { CallsBoard, CtaBand, Portrait } from "@/components/blocks";
import { NarrativeFigure } from "@/components/figures";
import { BEST_CALLS_MIN_RETURN, MARKETS } from "@/lib/model";
import { getPublications } from "@/lib/queries";

export const metadata: Metadata = { title: "Company" };

/**
 * Company (Kevin 2026-11-06: « level up le professionalism, copie ce qui se fait de mieux chez les concurrents »):
 * Altas's photo hero, statement with three columns and founder split with a pull quote; the four idea types from
 * Thierry's own fund site, as cards; the calls scoreboard; the price vs value figure.
 */
const PILLARS = [
  { key: "Under-covered", body: "markets and small caps that few analysts follow and big funds cannot buy." },
  { key: "Both sides", body: "long when a bad story turns, short when a hyped one cracks." },
  { key: "On the record", body: "every call published with its thesis, then followed to the exit." },
] as const;

const LOOK_FOR = [
  { title: "Turnaround stories", body: "Companies leaving a setback behind, still priced for the bad years.", icon: "M4 17l6-6 4 4 6-7M14 8h6v6" },
  { title: "Demand shocks", body: "A shift in demand lifts sales, and the market has not priced it yet.", icon: "M3 4h2l2.4 11h11L21 7H6.2M9 20a1 1 0 1 0 0-.01M18 20a1 1 0 1 0 0-.01" },
  { title: "Event driven", body: "Spin-offs, buybacks, activists or new rules create a mispricing.", icon: "M12 3l9 16H3zM12 10v4M12 17v.01" },
  { title: "Overlooked quality", body: "Strong businesses with lasting returns that the market ignores.", icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" },
] as const;

export default async function Company() {
  const posts = await getPublications();
  return (
    <>
      <section className="photo-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/img/company-hero.jpg" alt="" aria-hidden="true" />
        <div className="photo-hero-veil" />
        <div className="wrap photo-hero-inner">
          <p className="band-label">Company</p>
          <h1>Independent equity research</h1>
          <p>Small and mid caps, long and short, read from the buy side.</p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <p className="statement">We look where the price has drifted far from what the business is worth.</p>
          <div className="pillars">
            {PILLARS.map((p) => (
              <p key={p.key}>
                <strong>{p.key}</strong> {p.body}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="section grey">
        <div className="wrap">
          <h2 className="h-bold">What we look for</h2>
          <div className="look-for">
            {LOOK_FOR.map((c) => (
              <div key={c.title} className="lf-card">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d={c.icon} />
                </svg>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            ))}
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

      <section className="section">
        <div className="wrap founder">
          <div className="founder-photo">
            <Portrait />
          </div>
          <div className="founder-text">
            <p className="band-label dark">Founder and Lead Analyst</p>
            <h2>Thierry Matin</h2>
            <p>He trained in small cap and macro research at CI Global, Fiera Capital and BCA Research, then in private equity at Novacap.</p>
            <p>He founded Dualis Research to publish the work in full: the thesis, the numbers, and the exit.</p>
            <blockquote>Play winnable games. The best odds sit where fewer eyes look.</blockquote>
          </div>
        </div>
      </section>

      <section className="section grey split">
        <div className="wrap split-grid reverse">
          <div className="figure-wrap">
            <NarrativeFigure />
          </div>
          <div className="prose">
            <h2 className="h-bold">Price follows the story</h2>
            <p>Value follows the business. When the two drift apart and the story starts to turn, there is a trade.</p>
            <p className="markets-line">
              Coverage: {MARKETS.join(" · ")}
            </p>
          </div>
        </div>
      </section>

      <CtaBand title="Read the research" body="Every report, newest first, with the record behind each call." href="/research" cta="Open the research" />
    </>
  );
}
