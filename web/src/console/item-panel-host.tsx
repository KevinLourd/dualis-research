"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type PanelView, panel, pushUrl, setItemPage } from "./item-nav";
import { SlideOver } from "./slide-over";

/**
 * The level C panel of the Analysis page. The server renders the panel of the URL it was asked for (`initial`);
 * later panels open through `item-nav.ts` and load alone. The previous panel stays on screen until the next one is
 * there (never a skeleton).
 */
export function ItemPanelHost({
  symbol,
  base,
  shown,
  competing,
  initial,
}: {
  symbol: string;
  base: string;
  shown: "long" | "short" | null;
  competing: boolean;
  initial: { item: string; thesis: string | null; view: PanelView | null } | null;
}) {
  const params = useSearchParams();
  const item = params.get("item");
  const thesisParam = params.get("thesis");
  const thesis = thesisParam === "long" || thesisParam === "short" ? thesisParam : null;
  const isInitial = !!initial && initial.item === item && initial.thesis === thesisParam;
  const [loaded, setLoaded] = useState<{ key: string; view: PanelView | null } | null>(null);
  const last = useRef<PanelView | null>(null);
  const key = `${item}|${thesisParam ?? ""}`;

  useEffect(() => {
    setItemPage({ pathname: new URL(base, window.location.href).pathname, symbol, shown, competing });
    return () => setItemPage(null);
  }, [base, symbol, shown, competing]);

  useEffect(() => {
    if (!item || isInitial) return;
    let live = true;
    panel(item, thesis).then((view) => live && setLoaded({ key, view }));
    return () => {
      live = false;
    };
  }, [item, thesis, key, isInitial]);

  if (!item) {
    last.current = null;
    return null;
  }
  const view = isInitial ? initial.view : loaded?.key === key ? loaded.view : last.current;
  if (!view) return null;
  last.current = view;
  const closeHref = thesisParam ? `${base}?thesis=${thesisParam}` : base;
  return (
    <SlideOver title={view.title} subtitle={view.subtitle ?? undefined} closeHref={closeHref} onClose={() => pushUrl(closeHref)} size="lg" back>
      {view.body}
    </SlideOver>
  );
}
