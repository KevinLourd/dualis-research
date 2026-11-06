"use client";

import { useEffect, useState } from "react";

/**
 * Whether the PAGE is dark (Kumo `data-mode="dark"` or a `dark` class on <html>), never the OS setting: the console is
 * light, and charts that followed a dark Mac drew light-grey labels on a white page (axis dates invisible, 2026-11-06).
 */
export function usePageDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    const sync = () => setDark(html.dataset.mode === "dark" || html.classList.contains("dark"));
    sync();
    const o = new MutationObserver(sync);
    o.observe(html, { attributes: true, attributeFilter: ["data-mode", "class"] });
    return () => o.disconnect();
  }, []);
  return dark;
}
