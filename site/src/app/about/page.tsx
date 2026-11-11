import type { Metadata } from "next";
import { Career } from "@/components/blocks";
import { Cover } from "@/components/cover";
import { PageBand } from "@/components/page-band";
import { LINKEDIN_URL, X_HANDLE, X_URL } from "@/lib/model";
import { getPublications } from "@/lib/queries";

export const metadata: Metadata = { title: "About" };

/** His name and photo live on this page only (Thierry 2026-11-09). Thierry's photo (LinkedIn portrait, extended to 4:5). */
function Portrait() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="portrait-img" src="/img/thierry.jpg" alt="Thierry Matin" width={1200} height={1489} />
  );
}

export default async function About() {
  const posts = (await getPublications()).slice(0, 3);
  return (
    <div className="about-page">
      <PageBand label="About" thread="about" />
      <section className="wrap">
        <article className="person">
          <div className="person-photo">
            <Portrait />
          </div>
          <div className="person-text">
            <h2>Thierry Matin</h2>
            <p className="role">Founder and Lead Analyst</p>
            <p>Thierry is the founder and lead analyst of Dualis Research. He covers smaller listed companies, long and short, across Asia, North America and Europe.</p>
            <p>His work starts where attention is scarce: under-covered markets, small caps, and turnarounds investors have given up on. He reads the narrative the market is paying for against what the business is worth, and acts when the two disagree.</p>
            <p>He treats markets like a poker room: choose the table where you hold the edge, then size each bet to the odds. Annie Duke&apos;s Thinking in Bets, a favourite on many hedge fund desks, shaped that habit.</p>
            <Career />
            <p className="person-links">
              <a target="_blank" rel="noopener noreferrer" href={LINKEDIN_URL}>LinkedIn</a>
              <a target="_blank" rel="noopener noreferrer" href={X_URL}>X {X_HANDLE}</a>
            </p>
          </div>
        </article>
      </section>
      {posts.length > 0 && (
        <section className="wrap recent">
          <h2>Recently published</h2>
          <div className="recent-grid">
            {posts.map((p) => (
              <a target="_blank" rel="noopener noreferrer" key={p.id} href={p.url} className="recent-card">
                <Cover post={p} />
                <h3>{p.title}</h3>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
