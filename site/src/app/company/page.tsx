import type { Metadata } from "next";
import { CtaBand } from "@/components/blocks";
import { type Card, CardGlyph, PlayingCard } from "@/components/cards";
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
const LOOK_FOR: readonly Card[] = [
  { rank: "10", title: "Small caps", line: "Fewer expert investors look here, so prices stray further from value." },
  { rank: "J", title: "Cyclical stocks", line: "Big funds avoid timing cycles, so each turn meets fewer rivals." },
  { rank: "Q", title: "Turnaround stories", line: "Few dare to own a stock that got crushed. A story turning there is the play we train most." },
  { rank: "K", title: "Under-covered geographies", line: "Korea, Japan, China and India get a fraction of the analyst coverage." },
];

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
              <p className="band-thread">
                <CardGlyph />
                {WINNABLE.company}
              </p>
            </div>
          </div>
          <div className="look-for">
            {LOOK_FOR.map((c) => (
              <PlayingCard key={c.title} card={c} />
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
