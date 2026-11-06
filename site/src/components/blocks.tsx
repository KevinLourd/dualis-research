import Link from "next/link";
import { BEST_CALLS, categoryLabel, DISCLAIMER, formatDate, PLANS, TRACK_RECORD } from "@/lib/model";
import type { Publication } from "@/lib/queries";
import { Cover } from "./cover";
import { SubscribeButton } from "./subscribe-button";
import { YtdChart } from "./ytd-chart";

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

/** The closing band of every page: deep indigo, the statement on the left, one action on the right. */
export function CtaBand({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <section className="cta-band">
      <div className="wrap cta-inner">
        <div>
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
        {href.startsWith("http") ? (
          <a target="_blank" rel="noopener noreferrer" className="btn btn-light btn-lg" href={href}>
            {cta}
          </a>
        ) : (
          <Link className="btn btn-light btn-lg" href={href}>
            {cta}
          </Link>
        )}
      </div>
    </section>
  );
}

/**
 * Every report as a horizontal strip on black (Thierry 2026-11-06, away from Aurelion's fan): covers in black and
 * white; the one under the pointer grows and turns to colour. Native horizontal scroll when they overflow.
 */
export function CoverStrip({ posts }: { posts: Publication[] }) {
  return (
    <ol className="cover-strip" aria-label="Reports">
      {posts.map((p) => (
        <li key={p.id}>
          <a target="_blank" rel="noopener noreferrer" href={p.url} className="cs-item">
            <Cover post={p} />
          </a>
        </li>
      ))}
    </ol>
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
  { when: "2026 - now", where: "Dualis Research", role: "Founder and Lead Analyst" },
  { when: "2023 - 2024", where: "Novacap", role: "Private equity investor" },
  { when: "2022 - 2023", where: "BCA Research", role: "Research associate, FX and fixed income strategy" },
  { when: "2021", where: "Fiera Capital", role: "Analyst, global equities" },
  { when: "2021", where: "CI Global Asset Management", role: "Research analyst, global small cap equities" },
  { when: "2020", where: "BCI", role: "Summer analyst, U.S. small cap equities" },
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

/** The three newest reports as rows: cover, shelf and date, title, subtitle, "Read the report" (after Altas's news list). */
export function LatestResearch({ posts }: { posts: Publication[] }) {
  return (
    <ol className="latest">
      {posts.slice(0, 3).map((p) => (
        <li key={p.id}>
          <a target="_blank" rel="noopener noreferrer" href={p.url}>
            <Cover post={p} />
            <div>
              <p className="lt-meta">{formatDate(p.publishedAt)}</p>
              <h3 className="lt-title">{p.title}</h3>
              {p.subtitle && <p className="lt-sub">{p.subtitle}</p>}
              <p className="lt-foot">
                <span className="lt-tag">{categoryLabel(p.category)}</span>
                <span className="lt-read">Read the report ↗</span>
              </p>
            </div>
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * The published record on deep indigo (after Pernas's portfolio block): the year-to-date figure, the best calls, and
 * the curve from Thierry's own post vs the S&P 500.
 */
export function Proof() {
  const figures = [
    { big: `+${TRACK_RECORD.ytdPct}%`, small: "Portfolio, year to date*" },
    { big: `+${TRACK_RECORD.benchmarkPct}%`, small: `${TRACK_RECORD.benchmark}, same period` },
    ...BEST_CALLS.map((c) => ({ big: "40%+", small: `${c.name}, ${c.side.toLowerCase()}` })),
  ];
  return (
    <section className="section deep proof" id="performance">
      <div className="wrap proof-grid">
        <div>
          <p className="proof-kicker">Track record</p>
          <h2>
            Up {TRACK_RECORD.ytdPct}% this year, against {TRACK_RECORD.benchmarkPct}% for the {TRACK_RECORD.benchmark}.
          </h2>
          <dl className="proof-figures">
            {figures.map((f) => (
              <div key={f.small}>
                <dt>{f.big}</dt>
                <dd>{f.small}</dd>
              </div>
            ))}
          </dl>
          <a target="_blank" rel="noopener noreferrer" className="link-arrow" href={TRACK_RECORD.sourceUrl}>
            Read the performance update ↗
          </a>
        </div>
        <div>
          <YtdChart source={`Return since January 1, 2026: Thierry Matin's main account (about +55%) vs the S&P 500, from his post of ${formatDate(TRACK_RECORD.asOf)}.`} />
          <p className="footnote">*{TRACK_RECORD.note}</p>
        </div>
      </div>
    </section>
  );
}

const TRUST = [
  {
    title: "Institutional training",
    body: "Thierry Matin covered global small caps at CI Global and macro strategy at BCA Research before he founded Dualis Research.",
    icon: "M4 20h16M6 20V10M10 20V10M14 20V10M18 20V10M3 10l9-6 9 6z",
  },
  {
    title: "Every call on the record",
    body: "Each idea is published with its thesis, then followed to the exit. Winners and losers stay online.",
    icon: "M6 3h9l4 4v14H6zM14 3v5h5M9 13l2 2 4-4M9 18h7",
  },
  {
    title: "Long and short",
    body: "Cheap stories about to turn, and hyped stories about to crack. Both sides come from the same work.",
    icon: "M7 20V5M3 9l4-4 4 4M17 4v15M13 15l4 4 4-4",
  },
] as const;

/** Three reasons to read, icon top right (after Pernas). */
export function TrustCards() {
  return (
    <div className="trust">
      {TRUST.map((t) => (
        <div key={t.title} className="trust-card">
          <div className="trust-top">
            <h3>{t.title}</h3>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d={t.icon} />
            </svg>
          </div>
          <p>{t.body}</p>
        </div>
      ))}
    </div>
  );
}
