"use client";

import { Sidebar, useSidebar } from "@cloudflare/kumo";
import {
  DatabaseIcon,
  GearSixIcon,
  LightningIcon,
  ListBulletsIcon,
  BriefcaseIcon,
  NotePencilIcon,
  TrendUpIcon,
} from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "./logo";

const RESEARCH = [
  { href: "/", label: "Signals", icon: LightningIcon },
  { href: "/portfolio", label: "Portfolio", icon: BriefcaseIcon },
  { href: "/tickers", label: "Tickers", icon: ListBulletsIcon },
  { href: "/content", label: "Content", icon: NotePencilIcon },
  { href: "/growth", label: "Growth", icon: TrendUpIcon },
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
        <Sidebar.Group>
          <Sidebar.GroupLabel>Research</Sidebar.GroupLabel>
          <Sidebar.Menu>
            {RESEARCH.map(({ href, label, icon }) => (
              <Sidebar.MenuButton key={href} href={href} icon={icon} tooltip={label} active={isActive(pathname, href)}>
                {label}
              </Sidebar.MenuButton>
            ))}
          </Sidebar.Menu>
        </Sidebar.Group>
        <Sidebar.Group>
          <Sidebar.GroupLabel>Operations</Sidebar.GroupLabel>
          <Sidebar.Menu>
            <Sidebar.MenuButton href="/data" icon={DatabaseIcon} tooltip="Data" active={isActive(pathname, "/data")}>
              Data
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
