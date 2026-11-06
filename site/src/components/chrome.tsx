import Link from "next/link";
import { BRAND, DISCLAIMER, subscribeHref } from "@/lib/model";
import { Mark } from "./mark";
import { Social } from "./social";
import { SubscribeButton } from "./subscribe-button";

const NAV = [
  { href: "/company", label: "Company" },
  { href: "/research", label: "Research" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function Header({ substackUrl }: { substackUrl: string | null }) {
  return (
    <header className="site-header">
      <div className="wrap bar">
        <Link href="/" className="brand" aria-label={`${BRAND}, home`}>
          <Mark />
          <span className="wordmark">
            <span>Dualis</span>
            <span>Research</span>
          </span>
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
      </div>
    </header>
  );
}

const FOOTER_COLUMNS = [
  { title: "Research", links: [{ href: "/research", label: "Latest research" }, { href: "/research#portal", label: "Research portal" }, { href: "/subscribe", label: "Plans" }] },
  { title: "Firm", links: [{ href: "/company", label: "Company" }, { href: "/portfolio", label: "Portfolio" }, { href: "/about", label: "About" }, { href: "/contact", label: "Contact" }] },
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
            <Mark />
            <span className="wordmark">
              <span>Dualis</span>
              <span>Research</span>
            </span>
          </Link>
          <p>Independent equity research on small and mid caps, long and short.</p>
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
