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

export function Footer({ substackUrl }: { substackUrl: string | null }) {
  const subscribe = subscribeHref(substackUrl);
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-top">
          <p className="footer-contact">
            Contact: <Link href="/contact">write to Thierry</Link>
          </p>
          <Social substackUrl={substackUrl} />
        </div>
        <div className="footer-row">
          <ul>
            <li>
              <Link href="/disclaimer">Disclaimer</Link>
            </li>
            <li>
              <Link href="/subscribe">Plans</Link>
            </li>
            <li>
              <Link href="/terms">Terms of Use</Link>
            </li>
            <li>
              <Link href="/privacy">Privacy Policy</Link>
            </li>
          </ul>
          {subscribe && (
            // A plain GET form: Substack's subscribe page opens with the address filled in. Nothing is stored here.
            <form className="footer-signup" action={subscribe} method="get" target="_blank">
              <label htmlFor="footer-email">Get every report by email</label>
              <div className="fs-row">
                <input id="footer-email" type="email" name="email" placeholder="you@example.com" required autoComplete="email" />
                <button type="submit">Subscribe</button>
              </div>
            </form>
          )}
        </div>
        <p className="footer-legal">© 2026 {BRAND}. All rights reserved.</p>
        <p className="footer-legal">{DISCLAIMER}</p>
      </div>
    </footer>
  );
}
