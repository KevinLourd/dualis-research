"use client";

import { Button, Input, Select } from "@cloudflare/kumo";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { savePosition } from "./portfolio-actions";

/** Thierry types his own position facts. Prefilled with what is known; an empty box is left as it is. */
export function PositionForm({
  symbol,
  currency,
  initial,
}: {
  symbol: string;
  currency: string | null;
  initial: { direction: string | null; entryDate: string | null; entryPrice: number | null; weight: number | null; status: string | null };
}) {
  const router = useRouter();
  const [direction, setDirection] = useState(initial.direction ?? "");
  const [status, setStatus] = useState(initial.status ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-5"
      action={(fd) =>
        start(async () => {
          setError(null);
          fd.set("direction", direction);
          fd.set("status", status);
          try {
            await savePosition(symbol, fd);
            router.push("/portfolio", { scroll: false });
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
    >
      <Select label="Direction" className="w-48" value={direction} onValueChange={(v) => setDirection(String(v ?? ""))} items={{ long: "Long", short: "Short" }} />
      <Input name="entryDate" type="date" label="Entry date" defaultValue={initial.entryDate ?? ""} className="w-48" />
      <Input name="entryPrice" inputMode="decimal" label={`Entry price per share${currency ? ` (${currency})` : ""}`} defaultValue={initial.entryPrice ?? ""} className="w-48" />
      <Input name="weight" inputMode="decimal" label="Weight in the portfolio (%)" defaultValue={initial.weight === null ? "" : String(Math.round(initial.weight * 1000) / 10)} className="w-48" />
      <Select label="Status" className="w-48" value={status} onValueChange={(v) => setStatus(String(v ?? ""))} items={{ open: "Open", closed: "Closed" }} />
      {error && <p className="text-sm text-kumo-danger">{error}</p>}
      <Button type="submit" variant="primary" loading={pending} className="self-start">
        Save position
      </Button>
    </form>
  );
}
