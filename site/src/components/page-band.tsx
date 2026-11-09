import type { Variant } from "./poker-formations";
import { PokerScene } from "./poker-scene";
import { WINNABLE } from "@/lib/winnable";

/**
 * The head of every inner page: a deep indigo band, the section name, one statement in large serif (after Altas's
 * statement block), and on the right the page's poker scene with its line of the « play winnable games » thread.
 */
export function PageBand({ label, line, scene }: { label: string; line?: string; scene?: Variant }) {
  return (
    <section className={`band${line ? "" : " band-short"}${scene ? " band-scene" : ""}`}>
      <div className="wrap band-inner">
        <div className="band-text">
          <p className="band-label">{label}</p>
          {line && <h1 className="band-line">{line}</h1>}
          {scene && <p className="band-thread">{WINNABLE[scene].line}</p>}
        </div>
        {scene && <PokerScene variant={scene} label={WINNABLE[scene].label} className="band-canvas" />}
      </div>
    </section>
  );
}
