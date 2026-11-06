"use client";

import NextLink from "next/link";
import { type ComponentProps, forwardRef } from "react";

/**
 * Every console link loads its page ahead (full prefetch as soon as the link shows), and the browser keeps it
 * (`staleTimes` in next.config.ts): a click renders at once, never after a server round trip (Kevin 2026-11-05).
 */
const Link = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(({ prefetch = true, ...rest }, ref) => (
  <NextLink ref={ref} prefetch={prefetch} {...rest} />
));
Link.displayName = "Link";
export default Link;
