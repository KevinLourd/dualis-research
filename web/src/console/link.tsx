"use client";

import NextLink from "next/link";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { useRouter } from "next/navigation";
import { type ComponentProps, forwardRef, useCallback } from "react";
import { openPanel, preloadPanel } from "./item-nav";

/**
 * Loads `href` in full the moment the user shows intent (pointer over it, keyboard focus, finger down): the page is
 * ready, or already on its way, when the click lands, and the browser keeps it 5 minutes (`staleTimes` in
 * next.config.ts). Never on sight: a page lists 10 to 25 links, and loading them all on every view drained the
 * Worker's CPU allowance on the Workers free plan, so real clicks came back as a blank 503 (2026-11-06).
 */
export function usePrefetchOnIntent(href: string) {
  const router = useRouter();
  // A panel link of the Analysis page loads that panel alone, never the page behind it (item-nav.ts).
  return useCallback(() => {
    if (!preloadPanel(href)) router.prefetch(href, { kind: PrefetchKind.FULL });
  }, [router, href]);
}

type Props = Omit<ComponentProps<typeof NextLink>, "href" | "prefetch"> & { href: string };

const Link = forwardRef<HTMLAnchorElement, Props>(({ href, onMouseEnter, onFocus, onTouchStart, onClick, ...rest }, ref) => {
  const load = usePrefetchOnIntent(href);
  return (
    <NextLink
      ref={ref}
      href={href}
      prefetch={false}
      onMouseEnter={(e) => {
        load();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        load();
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        load();
        onTouchStart?.(e);
      }}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (openPanel(href)) e.preventDefault();
      }}
      {...rest}
    />
  );
});
Link.displayName = "Link";
export default Link;
