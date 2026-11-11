import Link from "next/link";
import { BEST_CALLS, categoryLabel, DISCLAIMER, formatDate, PLANS, TRACK_RECORD } from "@/lib/model";
import type { Publication } from "@/lib/queries";
import { Cover } from "./cover";
import { SubscribeButton } from "./subscribe-button";
import type { Card } from "./cards";
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

/** His career, from his public LinkedIn profile (2026-11-04). */
export const CAREER = [
  { when: "2024 - now", where: "Dualis Research", role: "Founder and Lead Analyst" },
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
    ...BEST_CALLS.map((c) => ({ big: c.result, small: `${c.name}, ${c.side.toLowerCase()}` })),
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
          <YtdChart source={`Return since January 1, 2026: the main account (about +55%) vs the S&P 500, from the post of ${formatDate(TRACK_RECORD.asOf)}.`} />
          <p className="footnote">*{TRACK_RECORD.note}</p>
        </div>
      </div>
    </section>
  );
}

/**
 * The winnable games we look for (Thierry 2026-11-09: the types of winnable games, never a timeline of steps), dealt as
 * a hand on Research (Kevin 2026-11-11: option A). The narrative turn, the play Thierry trains most, is the ace.
 */
export const GAMES: readonly Card[] = [
  { rank: "10", title: "Small caps", line: "Fewer experts, wider mispricing" },
  { rank: "J", title: "Cyclical stocks", line: "Each turn meets fewer rivals" },
  { rank: "A", title: "Narrative turns", line: "Long when a bad story turns, short when a hyped one cracks", ace: true },
  { rank: "Q", title: "Turnaround stories", line: "Crushed names few dare to own" },
  { rank: "K", title: "Under-covered geographies", line: "Markets most analysts skip" },
];
