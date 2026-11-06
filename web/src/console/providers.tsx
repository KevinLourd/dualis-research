"use client";

import { type LinkComponentProps, LinkProvider } from "@cloudflare/kumo";
import Link from "./link";
import { forwardRef } from "react";

const AppLink = forwardRef<HTMLAnchorElement, LinkComponentProps>(({ href, ...rest }, ref) => (
  <Link ref={ref} href={href ?? "#"} {...rest} />
));
AppLink.displayName = "AppLink";

/** Every Kumo link (sidebar, breadcrumbs, links) navigates client-side through Next. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <LinkProvider component={AppLink}>{children}</LinkProvider>;
}
