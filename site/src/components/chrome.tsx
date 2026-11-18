import Link from "next/link";
import { BRAND, DISCLAIMER, subscribeHref } from "@/lib/model";
import { Mark } from "./mark";
import { NavMenu } from "./nav-menu";
import { Social } from "./social";
import { SubscribeButton } from "./subscribe-button";

const NAV = [
  { href: "/research", label: "Research" },
  { href: "/company", label: "Company" },
  { href: "/team", label: "Team" },
  { href: "/contact", label: "Contact" },
];

/**
 * The wordmark, justified (Thierry 2026-11-17): D over R flush left, S over H flush right. Each word's letters are
 * spread over the same width, set by « Dualis » at its tracking; « Research » takes whatever spacing fills it.
 */
function Wordmark() {
  return (
    <span className="wordmark" aria-hidden="true">
      {["Dualis", "Research"].map((word) => (
        <span key={word}>
          {[...word].map((letter, i) => (
            <span key={i}>{letter}</span>
          ))}
        </span>
      ))}
    </span>
  );
}

export function Header({ substackUrl }: { substackUrl: string | null }) {
  return (
    <header className="site-header">
      <div className="wrap bar">
        <Link href="/" className="brand" aria-label={`${BRAND}, home`}>
          <Mark />
          <Wordmark />
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="bar-actions">
          <SubscribeButton substackUrl={substackUrl} />
          {substackUrl && (
            <a target="_blank" rel="noopener noreferrer" className="btn btn-outline" href={substackUrl}>
              Read on Substack
            </a>
          )}
        </div>
        <NavMenu links={NAV} />
      </div>
    </header>
  );
}

const FOOTER_COLUMNS = [
  { title: "Research", links: [{ href: "/research", label: "Latest research" }, { href: "/research#portal", label: "Research portal" }, { href: "/subscribe", label: "Plans" }] },
  { title: "Firm", links: [{ href: "/company", label: "Company" }, { href: "/team", label: "Team" }, { href: "/contact", label: "Contact" }] },
  { title: "Legal", links: [{ href: "/terms", label: "Terms of Use" }, { href: "/privacy", label: "Privacy Policy" }, { href: "/disclaimer", label: "Disclaimer" }] },
];

/** Institutional footer (Kevin 2026-11-06): brand and line, three link columns, the email field, then the legal note. */
export function Footer({ substackUrl }: { substackUrl: string | null }) {
  const subscribe = subscribeHref(substackUrl);
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <Link href="/" className="brand" aria-label={`${BRAND}, home`}>
            <Mark tone="white" />
            <Wordmark />
          </Link>
          <p>Independent equity research focused on finding asymmetric inflections in under-covered markets.</p>
          <Social substackUrl={substackUrl} />
        </div>
        {FOOTER_COLUMNS.map((c) => (
          <nav key={c.title} className="footer-col" aria-label={c.title}>
            <p className="footer-col-title">{c.title}</p>
            <ul>
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
        {subscribe && (
          // A plain GET form: Substack's subscribe page opens with the address filled in. Nothing is stored here.
          <form className="footer-signup" action={subscribe} method="get" target="_blank">
            <label className="footer-col-title" htmlFor="footer-email">
              Research by email
            </label>
            <div className="fs-row">
              <input id="footer-email" type="email" name="email" placeholder="Email address" required autoComplete="email" />
              <button type="submit">Subscribe</button>
            </div>
            <p className="fs-note">Free. Unsubscribe at any time.</p>
          </form>
        )}
      </div>
      <div className="wrap footer-base">
        <p className="footer-legal">
          <strong>Important information.</strong> {DISCLAIMER} Performance figures are as reported by the author, gross of fees and not audited. Past performance does not guarantee future results.
        </p>
        <p className="footer-copy">© 2026 {BRAND}. All rights reserved.</p>
      </div>
    </footer>
  );
}
