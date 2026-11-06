import type { Metadata } from "next";
import { Career, Portrait } from "@/components/blocks";
import { Cover } from "@/components/cover";
import { LINKEDIN_URL, X_HANDLE, X_URL } from "@/lib/model";
import { getPublications } from "@/lib/queries";

export const metadata: Metadata = { title: "About" };

export default async function About() {
  const posts = (await getPublications()).slice(0, 3);
  return (
    <div className="about-page">
      <section className="wrap about-head">
        <h1>About</h1>
        <p>The analyst behind the research</p>
      </section>
      <section className="wrap">
        <article className="person">
          <div className="person-photo">
            <Portrait />
          </div>
          <div className="person-text">
            <h2>Thierry Matin</h2>
            <p className="role">Founder, Lead Research Analyst</p>
            <p>Thierry founded Dualis Research and runs Duality Asset Management, a global long/short equity fund that invests only its own capital, with a focus on smaller companies.</p>
            <p>His work starts where attention is scarce: under-covered markets, small caps, and turnarounds investors have given up on. He reads the narrative the market is paying for against what the business is worth, and acts when the two disagree.</p>
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
          <h2>Recently from Thierry</h2>
          <div className="recent-grid">
            {posts.map((p) => (
              <a target="_blank" rel="noopener noreferrer" key={p.id} href={p.url} className="recent-card">
                <Cover id={p.id} title={p.title} category={p.category} publishedAt={p.publishedAt} />
                <h3>{p.title}</h3>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
