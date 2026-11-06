import Link from "next/link";

/**
 * Home: one full-bleed hero on one screen, no scroll (Kevin 2026-11-05). Background = a trading-floor clip (Mixkit
 * free licence, no credit required) under a deep indigo veil (Kevin 2026-11-06, replaces the still constellation).
 * Muted, looped; reduced motion shows the still poster.
 */
export default function Home() {
  return (
    <section className="hero">
      <video className="hero-video" autoPlay muted loop playsInline preload="auto" poster="/video/hero-poster.jpg" aria-hidden="true">
        <source src="/video/hero.mp4" type="video/mp4" />
      </video>
      <div className="hero-veil" />
      <div className="wrap hero-inner">
        {/* Thierry 2026-11-06: buy-side, on the investor's side, unlike sell-side analysts paid by the companies. */}
        <h1>
          Independent research
          <br />
          for buy-side opportunities
        </h1>
        <p className="hero-sub">Written for investors, never for the companies we cover.</p>
        <Link href="/research" className="hero-link">
          Read the research
        </Link>
      </div>
    </section>
  );
}
