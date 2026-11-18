import type { Metadata } from "next";
import { CtaBand } from "@/components/blocks";
import { CardCarousel } from "@/components/card-carousel";
import { Icon, type Card } from "@/components/cards";
import { AsymmetryFigure, DispersionFigure } from "@/components/edge-figures";
import { MARKETS } from "@/lib/model";

export const metadata: Metadata = { title: "Investment Process" };

/**
 * Investment Process (« Company » until Kevin 2026-11-18, `/company` redirects) (Kevin 2026-11-06: « level up le professionalism, copie ce qui se fait de mieux chez les concurrents »):
 * Altas's photo hero and statement with three columns; what we look for as a card carousel, two setups and two figures (Thierry 2026-11-17); the « play winnable games » line.
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
 * What we look for, in Thierry's words (file of 2026-11-17): four cards flipped through as a carousel, then two setups
 * side by side under « Primary Setups », then dispersion and asymmetry, each beside a figure with no words
 * (Kevin 2026-11-18). The site never names where he lives.
 */
const LOOK_FOR: readonly Card[] = [
  {
    suit: "spade",
    icon: "small-caps",
    title: "Small caps",
    line: "Given the barriers to larger pools of capital, fewer institutional investors participate in small/micro-cap opportunities. The smaller number of sophisticated investors leads to an increased probability of mispricings.",
  },
  {
    suit: "heart",
    icon: "cycle",
    title: "Cyclical stocks",
    line: "Investors tend to extrapolate current earnings, so cyclicals look cheapest at the peak and most expensive at the trough. Many investors who are uncomfortable with top-down work avoid the space altogether, which leaves opportunities on both sides of the cycle.",
  },
  {
    suit: "club",
    icon: "globe",
    title: "Under-covered geographies",
    line: "Language barriers, local disclosure norms and thin sell-side or foreign coverage keep most global capital out of many non-western markets. Policy catalysts, such as governance reforms, can force re-ratings that domestic investors are slow to anticipate.",
  },
  {
    suit: "diamond",
    icon: "themes",
    title: "Under-covered themes",
    line: "Crowded narratives are priced at the megacap level, but their second- and third-order effects across the value chain often aren’t priced as efficiently. Lesser-known themes in under-appreciated markets also tend to go unnoticed until the fundamentals begin to attract incremental buyers.",
  },
];

const SETUPS = [
  {
    title: "Inflections",
    icon: "inflection",
    body: "Consensus often extrapolates a recent trend linearly, which can lead to turning points in the fundamentals getting mispriced in both directions. Businesses priced for permanent decline can re-rate sharply on structural improvement. Stocks priced on a growth story can de-rate hard once earnings power stops supporting it. At the extremes, narrative and fundamentals reinforce each other, so outcomes are more lopsided than consensus models assume.",
  },
  {
    title: "Overlooked quality",
    icon: "quality",
    body: "Businesses with strong competitive advantages and high ROICs with durable cash flows can often trade at discounts since the market undervalues the firm’s terminal cash flows. Low beta equities under this category provide an opportunity to add leverage.",
  },
] as const;

export default function InvestmentProcess() {
  return (
    <>
      <section className="photo-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/img/company-hero.jpg" alt="" aria-hidden="true" />
        <div className="photo-hero-veil" />
        <div className="wrap photo-hero-inner">
          <p className="band-label">Investment Process</p>
          <h1>Independent equity research</h1>
          <p>Constantly on the lookout for asymmetric opportunities where we feel we have the most edge.</p>
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
              <p className="tables-intro">
                We look for markets where we believe we have edge. Our small scale and willingness to hunt where institutions won’t provide us opportunities. We play at
                tables where competition is sparse.
              </p>
            </div>
          </div>
          <CardCarousel cards={LOOK_FOR} />
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="h-bold">Primary Setups</h2>
          <div className="setups">
            {SETUPS.map((s) => (
              <article key={s.title}>
                <h3>
                  <Icon name={s.icon} className="setup-icon" />
                  {s.title}
                </h3>
                <p>{s.body}</p>
              </article>
            ))}
          </div>
          <div className="edge-panel">
            <p>We look for opportunities with a low dispersion of outcomes. The wider the range of possible outcomes, the more difficult it is to size a probability adjusted bet.</p>
            <DispersionFigure />
            <p>We look for asymmetric bets where the upside is skewed in our favor relative to the potential downside of our trades.</p>
            <AsymmetryFigure />
          </div>
        </div>
      </section>

      <section className="section">
        <figure className="wrap founder-quote">
          <blockquote>We seek to play winnable games. The best odds sit where fewer eyes look.</blockquote>
        </figure>
      </section>

      <CtaBand title="Read the research" body="Every report, newest first, with the record behind each call." href="/research" cta="Open the research" />
    </>
  );
}
