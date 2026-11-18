"use client";

import { Sidebar, useSidebar } from "@cloudflare/kumo";
import {
  FlaskIcon,
  GearSixIcon,
  LightningIcon,
  ListBulletsIcon,
  BriefcaseIcon,
  NotePencilIcon,
  TestTubeIcon,
  TrendUpIcon,
} from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "./logo";

const RESEARCH = [
  { href: "/", label: "Signals", icon: LightningIcon },
  { href: "/portfolio", label: "Portfolio", icon: BriefcaseIcon },
  { href: "/tickers", label: "Tickers", icon: ListBulletsIcon },
  { href: "/live-test", label: "Live test", icon: FlaskIcon },
] as const;

const BUSINESS = [
  { href: "/content", label: "Content", icon: NotePencilIcon },
  { href: "/growth", label: "Growth", icon: TrendUpIcon },
] as const;

// One page per fake account (Kevin 2026-11-11: « une SECTION Sandbox, une page par compte »); handles = sandbox-accounts seed.
const SANDBOX_TONES = [
  { handle: "sirensmallcaps", tone: "urgent" },
  { handle: "narrativegap", tone: "balanced" },
  { handle: "ledgerlens", tone: "neutral" },
] as const;
const SANDBOX = [
  ...SANDBOX_TONES.map(({ handle, tone }) => ({ href: `/sandbox/x/${handle}`, label: `X ${tone}` })),
  ...SANDBOX_TONES.map(({ handle, tone }) => ({ href: `/sandbox/substack/${handle}`, label: `Substack ${tone}` })),
];

const OPERATIONS = [
  { href: "/data", label: "Data" },
  { href: "/design", label: "Design system" },
  { href: "/settings", label: "Settings" },
] as const;

const GROUPS = [
  { label: "Research", items: RESEARCH },
  { label: "Business", items: BUSINESS },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * A folded entry (Kevin 2026-11-18: a shorter sidebar): its pages show on a click, and it opens by itself on one of them.
 */
function Folded({ label, icon, items, pathname }: { label: string; icon: typeof GearSixIcon; items: readonly { href: string; label: string }[]; pathname: string }) {
  return (
    <Sidebar.MenuItem>
      <Sidebar.Collapsible defaultOpen={items.some((x) => isActive(pathname, x.href))}>
        <Sidebar.CollapsibleTrigger
          render={
            <Sidebar.MenuButton icon={icon} tooltip={label}>
              {label}
              <Sidebar.MenuChevron />
            </Sidebar.MenuButton>
          }
        />
        <Sidebar.CollapsibleContent>
          <Sidebar.MenuSub>
            {items.map((x) => (
              <Sidebar.MenuSubButton key={x.href} href={x.href} active={isActive(pathname, x.href)}>
                {x.label}
              </Sidebar.MenuSubButton>
            ))}
          </Sidebar.MenuSub>
        </Sidebar.CollapsibleContent>
      </Sidebar.Collapsible>
    </Sidebar.MenuItem>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  // Phone: the sidebar is a sheet; it closes once a link has changed the page.
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);
  return (
    <Sidebar>
      <Sidebar.Header>
        <Logo />
      </Sidebar.Header>
      <Sidebar.Content>
        {GROUPS.map((group) => (
          <Sidebar.Group key={group.label}>
            <Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
            <Sidebar.Menu>
              {group.items.map(({ href, label, icon }) => (
                <Sidebar.MenuButton key={href} href={href} icon={icon} tooltip={label} active={isActive(pathname, href)}>
                  {label}
                </Sidebar.MenuButton>
              ))}
              {group.label === "Business" && <Folded label="Sandbox" icon={TestTubeIcon} items={SANDBOX} pathname={pathname} />}
            </Sidebar.Menu>
          </Sidebar.Group>
        ))}
        <Sidebar.Group>
          <Sidebar.Menu>
            <Folded label="Operations" icon={GearSixIcon} items={OPERATIONS} pathname={pathname} />
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
      <Sidebar.Footer>
        <Sidebar.Trigger />
      </Sidebar.Footer>
    </Sidebar>
  );
}
