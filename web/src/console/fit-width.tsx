"use client";

import { Fragment, useEffect, useRef, useState } from "react";

/**
 * Redraws a Kumo chart when its frame changes width. Kumo's Chart skips the first resize it observes, so a chart drawn
 * while the page still had its desktop layout (server render on a phone, before the sidebar turns into a sheet) kept
 * that narrow width for good. Remounting on a width change (rounded to 16 px) draws it at the real width.
 */
export function FitWidth({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width / 16)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="w-full min-w-0">
      <Fragment key={width}>{children}</Fragment>
    </div>
  );
}
