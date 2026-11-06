import Link from "next/link";
import { DISCLAIMER, PLANS } from "@/lib/model";
import type { Publication } from "@/lib/queries";
import { Cover } from "./cover";
import { Social } from "./social";
import { SubscribeButton } from "./subscribe-button";

export function Plans({ substackUrl }: { substackUrl: string | null }) {
  return (
    <>
      <div className="plans">
        <div className="plan">
          <h3>Free</h3>
          <div className="price">$0</div>
          <ul>
            <li>Every free report and memo</li>
            <li>Short notes on Substack and X</li>
          </ul>
          <SubscribeButton substackUrl={substackUrl} label="Join free" variant="outline" />
        </div>
        <div className="plan featured">
          <h3>Annual</h3>
          <div className="price">
            ${PLANS.annual.price}
            <small> / year</small>
          </div>
          <p className="muted">Two months free compared with monthly.</p>
          <ul>
            <li>Every full report, as it is published</li>
            <li>An update when the facts change</li>
            <li>What would prove each thesis wrong</li>
          </ul>
          <SubscribeButton substackUrl={substackUrl} label="Subscribe yearly" />
        </div>
        <div className="plan">
          <h3>Monthly</h3>
          <div className="price">
            ${PLANS.monthly.price}
            <small> / month</small>
          </div>
          <ul>
            <li>Everything in the annual plan</li>
            <li>Cancel any time</li>
          </ul>
          <SubscribeButton substackUrl={substackUrl} label="Subscribe monthly" variant="outline" />
        </div>
      </div>
      <p className="plans-note">Payment, emails and cancellation are handled by Substack. {DISCLAIMER}</p>
    </>
  );
}

export const FAQ: { q: string; a: string }[] = [
  { q: "What do I get when I subscribe?", a: "Every full report as it is published, by email and on Substack, plus an update whenever a fact moves one of the theses." },
  { q: "Which companies do you cover?", a: "Mostly smaller listed companies in under-covered markets: Japan, Korea, Hong Kong, Canada, the US and beyond. Many are names few analysts follow." },
  { q: "How often do you publish?", a: "A full report when an idea is ready, and short notes on Substack and X in between." },
  { q: "Is this investment advice?", a: "No. Dualis Research is for information only. The author may hold positions in the securities discussed, and each report says so." },
  { q: "Can I cancel?", a: "Yes, any time, from your Substack account. You keep access until the end of the period you paid for." },
];

export function Faq() {
  return (
    <div className="faq">
      {FAQ.map((f) => (
        <details key={f.q}>
          <summary>{f.q}</summary>
          <p className="answer">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

/** The closing navy band of every page (Aurelion's "See the research at work"). */
export function CtaBand({ title, body, href, cta, substackUrl }: { title: string; body: string; href: string; cta: string; substackUrl: string | null }) {
  return (
    <section className="cta-band">
      <div className="wrap cta-inner">
        <h2>{title}</h2>
        <p>{body}</p>
        {href.startsWith("http") ? (
          <a target="_blank" rel="noopener noreferrer" className="btn btn-light btn-lg" href={href}>
            {cta} →
          </a>
        ) : (
          <Link className="btn btn-light btn-lg" href={href}>
            {cta} →
          </Link>
        )}
        <Social substackUrl={substackUrl} className="social social-side" />
      </div>
    </section>
  );
}

/** The latest covers fanned out, each opening its report (Aurelion's "From the Research Platform"). */
export function CoverFan({ posts }: { posts: Publication[] }) {
  const shown = posts.slice(0, 6);
  const mid = (shown.length - 1) / 2;
  return (
    <div className="fan">
      {shown.map((p, i) => (
        <a
          key={p.id}
          target="_blank"
          rel="noopener noreferrer"
          href={p.url}
          className="fan-item"
          style={{ "--rot": `${(i - mid) * 4}deg`, "--lift": `${Math.abs(i - mid) * 10}px`, zIndex: 10 - Math.round(Math.abs(i - mid)) } as React.CSSProperties}
        >
          <Cover id={p.id} title={p.title} category={p.category} publishedAt={p.publishedAt} />
        </a>
      ))}
    </div>
  );
}

/** Thierry's photo (LinkedIn portrait, extended to 4:5). */
export function Portrait() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="portrait-img" src="/img/thierry.jpg" alt="Thierry Matin" width={1200} height={1489} />
  );
}

/** His career, from his public LinkedIn profile (2026-11-04). */
export const CAREER = [
  { when: "2024 - now", where: "Duality Asset Management", role: "Fund Manager, global long/short equity" },
  { when: "2023 - 2024", where: "Novacap", role: "Private equity investor" },
  { when: "2022 - 2023", where: "BCA Research", role: "Research associate, FX and fixed income strategy" },
  { when: "2021", where: "Fiera Capital", role: "Analyst, global equities" },
  { when: "2021", where: "CI Global Asset Management", role: "Research analyst, global small cap equities" },
] as const;

export function Career() {
  return (
    <ul className="career">
      {CAREER.map((c) => (
        <li key={c.where}>
          <span className="when">{c.when}</span>
          <span>
            <strong>{c.where}</strong>
            <span className="role">{c.role}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
