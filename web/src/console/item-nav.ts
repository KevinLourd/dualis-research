"use client";

import { loadItemPanel } from "./item-actions";

/**
 * Item panels open WITHOUT re-rendering the Analysis page (Workers free plan CPU, 2026-11-17). A link to the same
 * Analysis page that only changes `?item=` (the shown thesis unchanged) is a "panel link": the URL changes through
 * `history.pushState` (Next keeps `useSearchParams` in sync, back/forward work) and `ItemPanelHost` asks the server for
 * that one panel (`loadItemPanel`). Any other link is a normal navigation.
 */
export type PanelView = { title: string; subtitle: string | null; body: React.ReactNode };
type Page = { pathname: string; symbol: string; shown: "long" | "short" | null; competing: boolean };

let page: Page | null = null;
export const setItemPage = (p: Page | null) => {
  page = p;
  if (!p) panels.clear();
};

const panels = new Map<string, Promise<PanelView | null>>();
/**
 * Panel loads still in flight. Next re-renders the whole page (a router refresh) when the URL changes while a server
 * action is pending, so the URL only changes once they have landed (`pushUrl`).
 */
const inFlight = new Set<Promise<unknown>>();
const panelKey = (item: string, thesis: string | null) => `${item}|${thesis ?? ""}`;

/** The panel `href` opens, when it is a panel link of the page on screen; else null. */
export function panelOf(href: string): { item: string | null; thesis: "long" | "short" | null } | null {
  if (!page || typeof window === "undefined") return null;
  const to = new URL(href, window.location.href);
  const now = new URL(window.location.href);
  if (to.origin !== now.origin || to.pathname !== now.pathname || to.pathname !== page.pathname) return null;
  for (const k of new Set([...to.searchParams.keys(), ...now.searchParams.keys()])) {
    if (k === "item" || k === "thesis") continue;
    if (to.searchParams.get(k) !== now.searchParams.get(k)) return null;
  }
  const thesis = to.searchParams.get("thesis");
  // Two theses compete: item links name the shown one; any other thesis is another page.
  if (page.competing && (thesis ?? now.searchParams.get("thesis") ?? page.shown) !== page.shown) return null;
  return { item: to.searchParams.get("item"), thesis: thesis === "long" || thesis === "short" ? thesis : null };
}

/** The panel, loaded once per page view (a hover starts it, the click reuses it). */
export function panel(item: string, thesis: "long" | "short" | null): Promise<PanelView | null> {
  if (!page) throw new Error("panel() outside an Analysis page");
  const key = panelKey(item, thesis);
  let p = panels.get(key);
  if (!p) {
    const loading = loadItemPanel(page.symbol, item, thesis);
    p = loading;
    panels.set(key, loading);
    inFlight.add(loading);
    loading.then(
      () => inFlight.delete(loading),
      () => {
        inFlight.delete(loading);
        panels.delete(key);
      },
    );
  }
  return p;
}

/** Hover / focus / touch: start loading a panel link's panel; false = not a panel link. */
export function preloadPanel(href: string): boolean {
  const target = panelOf(href);
  if (!target) return false;
  if (target.item) void panel(target.item, target.thesis);
  return true;
}

/** Changes the URL without a page render, once no panel load is in flight (see `inFlight`). */
export function pushUrl(href: string): void {
  if (inFlight.size === 0) return window.history.pushState(null, "", href);
  // Next leaves the action pending a moment after its promise settles: check again on a later task.
  void Promise.allSettled([...inFlight]).then(() => setTimeout(() => pushUrl(href), 50));
}

/** Click: open a panel link without a server round trip for the page; false = not a panel link. */
export function openPanel(href: string): boolean {
  const target = panelOf(href);
  if (!target) return false;
  if (target.item) void panel(target.item, target.thesis);
  pushUrl(href);
  return true;
}
