"use client";

import NextLink from "next/link";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { useRouter } from "next/navigation";
import { type ComponentProps, forwardRef, useCallback } from "react";

/**
 * Loads `href` in full the moment the user shows intent (pointer over it, keyboard focus, finger down): the page is
 * ready, or already on its way, when the click lands, and the browser keeps it 5 minutes (`staleTimes` in
 * next.config.ts). Never on sight: a page lists 10 to 25 links, and loading them all on every view drained the
 * Worker's CPU allowance on the Workers free plan, so real clicks came back as a blank 503 (2026-11-06).
 */
export function usePrefetchOnIntent(href: string) {
  const router = useRouter();
  return useCallback(() => router.prefetch(href, { kind: PrefetchKind.FULL }), [router, href]);
}

type Props = Omit<ComponentProps<typeof NextLink>, "href" | "prefetch"> & { href: string };

const Link = forwardRef<HTMLAnchorElement, Props>(({ href, onMouseEnter, onFocus, onTouchStart, ...rest }, ref) => {
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
      {...rest}
    />
  );
});
Link.displayName = "Link";
export default Link;
