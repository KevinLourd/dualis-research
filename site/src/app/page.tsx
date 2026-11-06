import Link from "next/link";

/**
 * Home: one full-bleed hero on one screen, no scroll (Kevin 2026-11-05). Background = a 34 s loop of the industries
 * and real assets experts expect to hold up in the AI era (Kevin 2026-11-06; BlackRock "HALO" sectors, Goldman Sachs
 * and S&P Global on grid and copper, JLL on data-center power, Macquarie on infrastructure): power generation, the
 * grid, copper and mining, semiconductors, data centers, oil and gas, robotics, space (a launch), defense (a missile
 * at sea), ports and shipping, food and agriculture. Never a caption in the footage (Kevin: « enlève ça »). Mixkit
 * free licence. Muted; reduced motion = poster.
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
        <p className="hero-sub">Long and short ideas in small and mid caps.</p>
        <Link href="/research" className="hero-link">
          Read the research
        </Link>
      </div>
    </section>
  );
}
