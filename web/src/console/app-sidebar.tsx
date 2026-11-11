"use client";

import { Sidebar, useSidebar } from "@cloudflare/kumo";
import {
  DatabaseIcon,
  FlaskIcon,
  GearSixIcon,
  LightningIcon,
  ListBulletsIcon,
  BriefcaseIcon,
  NotePencilIcon,
  PaletteIcon,
  NewspaperIcon,
  TrendUpIcon,
  XLogoIcon,
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
  ...SANDBOX_TONES.map(({ handle, tone }) => ({ href: `/sandbox/x/${handle}`, label: `X ${tone}`, icon: XLogoIcon })),
  ...SANDBOX_TONES.map(({ handle, tone }) => ({ href: `/sandbox/substack/${handle}`, label: `Substack ${tone}`, icon: NewspaperIcon })),
];

const GROUPS = [
  { label: "Research", items: RESEARCH },
  { label: "Business", items: BUSINESS },
  { label: "Sandbox", items: SANDBOX },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
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
            </Sidebar.Menu>
          </Sidebar.Group>
        ))}
        <Sidebar.Group>
          <Sidebar.GroupLabel>Operations</Sidebar.GroupLabel>
          <Sidebar.Menu>
            <Sidebar.MenuButton href="/data" icon={DatabaseIcon} tooltip="Data" active={isActive(pathname, "/data")}>
              Data
            </Sidebar.MenuButton>
            <Sidebar.MenuButton href="/design" icon={PaletteIcon} tooltip="Design system" active={isActive(pathname, "/design")}>
              Design system
            </Sidebar.MenuButton>
            <Sidebar.MenuButton href="/settings" icon={GearSixIcon} tooltip="Settings" active={isActive(pathname, "/settings")}>
              Settings
            </Sidebar.MenuButton>
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
      <Sidebar.Footer>
        <Sidebar.Trigger />
      </Sidebar.Footer>
    </Sidebar>
  );
}
