"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Small screens: the main nav folds into a menu (no animation). It closes once a link has changed the page. */
export function NavMenu({ links }: { links: readonly { href: string; label: string }[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  return (
    <details ref={ref} className="nav-menu">
      <summary aria-label="Menu">
        <span className="nav-menu-icon" aria-hidden="true" />
      </summary>
      <nav className="nav-menu-panel" aria-label="Main">
        {links.map((n) => (
          <Link key={n.href} href={n.href}>
            {n.label}
          </Link>
        ))}
      </nav>
    </details>
  );
}
