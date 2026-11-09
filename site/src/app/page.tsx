import Link from "next/link";
import { WINNABLE } from "@/lib/winnable";

/**
 * Home: one full-bleed hero on one screen, no scroll (Kevin 2026-11-05). Background = a 31 s loop of FRONTIER
 * technology only, the newest generation of each (Kevin 2026-11-09: « l'avion et la fusée font passé, les tous derniers
 * modèles les plus avancés »; old industries removed): Artemis II SLS launch, 2026 (NASA, public domain, Commons
 * "Artemis II Launch from OSB II Balcony - Slo Mo"), SpaceX Starship launch (Anne Toal, CC BY 3.0, Commons "SpaceX
 * Starship integrated flight test -5"), the YFQ-42A AI combat drone (U.S. Air Force, DVIDS 975160, public domain), a
 * humanoid robot at work (newscreators, CC BY 3.0, Commons "Robot package handling"), the NIF fusion target chamber
 * (LLNL, public domain), an AI data center (Mixkit), the B-21 Raider (U.S. Air Force, DVIDS 937050, public domain),
 * Artemis II climbing (NASA, public domain). CC BY credits live in the terms (`lib/legal.ts`). Never a caption in the
 * footage (cropped out). Muted; reduced motion = poster.
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
        <p className="band-thread">{WINNABLE.home}</p>
        <Link href="/research" className="hero-link">
          Read the research
        </Link>
      </div>
    </section>
  );
}
