import Link from "next/link";
import { PokerScene } from "@/components/poker-scene";
import { WINNABLE } from "@/lib/winnable";

/**
 * Home: one full-bleed hero on one screen, no scroll (Kevin 2026-11-05). Background = a 34 s loop of the industries
 * and real assets experts expect to hold up in the AI era (BlackRock "HALO" sectors, Goldman Sachs and S&P Global on
 * grid and copper, JLL on data-center power, Macquarie on infrastructure), hottest first (Kevin 2026-11-06): a SpaceX
 * Falcon 9 launch (U.S. Space Force video, public domain), the XQ-58 Valkyrie AI-piloted drone (U.S. Air Force,
 * public domain), robotics, semiconductors, data centers, power, the grid, oil and gas, ports, then raw materials
 * (copper and mining, agriculture). Other clips: Mixkit free licence. Never a caption in the footage. Muted;
 * reduced motion = poster.
 */
export default function Home() {
  return (
    <section className="hero">
      <video className="hero-video" autoPlay muted loop playsInline preload="auto" poster="/video/hero-poster.jpg" aria-hidden="true">
        <source src="/video/hero.mp4" type="video/mp4" />
      </video>
      <div className="hero-veil" />
      {/* The « play winnable games » thread (Kevin 2026-11-09): the poker scene on the right half, over a darker pool. */}
      <div className="hero-scene">
        <PokerScene variant="home" label={WINNABLE.home.label} className="hero-canvas" />
      </div>
      <div className="wrap hero-inner">
        {/* Thierry 2026-11-06: buy-side, on the investor's side, unlike sell-side analysts paid by the companies. */}
        <h1>
          Independent research
          <br />
          for buy-side opportunities
        </h1>
        <p className="hero-sub">Long and short ideas in small and mid caps.</p>
        <p className="band-thread">{WINNABLE.home.line}</p>
        <Link href="/research" className="hero-link">
          Read the research
        </Link>
      </div>
    </section>
  );
}
