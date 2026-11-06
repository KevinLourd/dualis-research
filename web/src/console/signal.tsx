import { Badge } from "@cloudflare/kumo";
import { ArrowRightIcon } from "@phosphor-icons/react/ssr";
import { stateWord } from "@/content/signal-words";

/** The signal pieces (server components): the narrative state badge, a state change, a titled section. */

const VARIANT: Record<string, "success" | "warning" | "neutral"> = { holds: "neutral", cracking: "warning" };

/** The narrative state: Holds, or Cracking (Inflecting on a long). */
export function StateBadge({ state, position }: { state: string; position: string | null }) {
  return (
    <Badge appearance="dot" variant={VARIANT[state] ?? "neutral"}>
      {stateWord(state, position)}
    </Badge>
  );
}

export function StateChange({ from, to, position }: { from: string; to: string; position: string | null }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StateBadge state={from} position={position} />
      <ArrowRightIcon size={14} className="text-kumo-subtle" aria-label="to" />
      <StateBadge state={to} position={position} />
    </span>
  );
}

/** A titled block of the ticker page: a quiet label, then the content, lots of air around it. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-medium tracking-wide text-kumo-subtle uppercase">{title}</h2>
      {children}
    </section>
  );
}
