"use client";

import { Button, Input } from "@cloudflare/kumo";
import { useState, useTransition } from "react";
import { saveColor } from "./actions";
import { COLOR_VALUE } from "./color";

function Swatch({ value }: { value: string }) {
  const ok = COLOR_VALUE.test(value.trim());
  return <span className="size-9 shrink-0 rounded-md ring-1 ring-kumo-line" style={{ background: ok ? value.trim() : "transparent" }} aria-hidden />;
}

/** Edit one colour, both themes. Saving starts the GitHub edit; the page shows the new value once it is on main. */
export function ColorForm({ name, light, dark }: { name: string; light: string; dark: string }) {
  const [l, setL] = useState(light);
  const [d, setD] = useState(dark);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-5"
      action={() =>
        start(async () => {
          setError(null);
          setDone(false);
          try {
            await saveColor(name, l, d);
            setDone(true);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
    >
      <div className="flex items-end gap-3">
        <Swatch value={l} />
        <Input label="Light theme" value={l} onChange={(e) => setL(e.target.value)} className="w-56 font-mono" />
      </div>
      <div className="flex items-end gap-3">
        <Swatch value={d} />
        <Input label="Dark theme" value={d} onChange={(e) => setD(e.target.value)} className="w-56 font-mono" />
      </div>
      {error && <p className="text-sm text-kumo-danger">{error}</p>}
      {done && (
        <p className="text-sm text-kumo-default">
          Saved. The new colour reaches this page and the website within 5 minutes, and the console with its next update.
        </p>
      )}
      <Button type="submit" variant="primary" loading={pending} className="self-start">
        Save colour
      </Button>
    </form>
  );
}
