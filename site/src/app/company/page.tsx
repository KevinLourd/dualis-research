import type { Metadata } from "next";
import { CtaBand } from "@/components/blocks";
import { MARKETS } from "@/lib/model";
import { WINNABLE } from "@/lib/winnable";

export const metadata: Metadata = { title: "Company" };

/**
 * Company (Kevin 2026-11-06: « level up le professionalism, copie ce qui se fait de mieux chez les concurrents »):
 * Altas's photo hero and statement with three columns; what we look for as cards; the « play winnable games » line.
 * Thierry 2026-11-06: no price vs value figure. Thierry 2026-11-09: no track record and no list of calls here (two
 * calls « makes it look like I've only got two things », the research portal holds them), and the line is unsigned
 * (« I haven't accomplished enough yet to start quoting myself »).
 */
const PILLARS = [
  { key: "Under-covered", body: "markets and small caps that few analysts follow and big funds cannot buy." },
  { key: "Both sides", body: "long when a bad story turns, short when a hyped one cracks." },
  { key: "On the record", body: "every call published with its thesis, then followed to the exit." },
] as const;

/**
 * Thierry's tables (call 2026-11-06): « You're at a poker table... Ideally you want to sit in tables where you feel like
 * you have an advantage... in financial markets it's the same thing. » The narrative turn is one strategy among them,
 * « probably the one that I train the most ». The site never names where he lives, so the market list stays generic.
 */
const LOOK_FOR = [
  { title: "Small caps", body: "Fewer expert investors look here, so prices stray further from value.", icon: "M4 20h4v-6H4zM10 20h4V9h-4zM16 20h4V4h-4z" },
  { title: "Cyclical stocks", body: "Big funds avoid timing cycles, so each turn meets fewer rivals.", icon: "M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" },
  { title: "Turnaround stories", body: "Few dare to own a stock that got crushed. A story turning there is the play we train most.", icon: "M4 7l6 6 4-4 6 7M14 16h6v-6" },
  { title: "Under-covered geographies", body: "Korea, Japan, China and India get a fraction of the analyst coverage.", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" },
] as const;

export default function Company() {
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
          <p className="markets-line">Coverage: {MARKETS.join(" · ")}</p>
        </div>
      </section>

      <section className="section deep tables">
        <div className="wrap">
          <div className="tables-head">
            <div>
              <h2 className="h-bold">What we look for</h2>
              <p className="tables-intro">A good poker player picks the table first. We pick opportunities where we see edge.</p>
              <p className="band-thread">{WINNABLE.company}</p>
            </div>
          </div>
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

      <section className="section">
        <figure className="wrap founder-quote">
          <blockquote>Play winnable games. The best odds sit where fewer eyes look.</blockquote>
        </figure>
      </section>

      <CtaBand title="Read the research" body="Every report, newest first, with the record behind each call." href="/research" cta="Open the research" />
    </>
  );
}
