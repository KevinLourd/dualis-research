import type { Bar } from "./compute";

/**
 * Significant price moves (Thierry 2026-11-17: « if the market cared at that moment, that's a driver that matters »).
 * Pure code, the console bundle may import it.
 *
 * Event-study convention (MacKinlay 1997, "Event Studies in Economics and Finance", Journal of Economic Literature
 * 35(1); Brown & Warner 1985): the abnormal return of a day = the stock's return minus what the market explains
 * (beta x the S&P 500's return, beta from an OLS regression over the trailing year, 1 when it cannot be estimated),
 * standardised by the standard deviation of the trailing year's abnormal returns. A day is significant when
 * |z| >= 2, i.e. beyond two standard deviations of its own normal volatility. Consecutive significant days of the
 * same sign are one move (a results day often runs over two or three sessions).
 */

/** Trading days in the trailing window (one year), and the fewest needed before a z-score means anything. */
export const MOVE_WINDOW_DAYS = 250;
export const MOVE_MIN_DAYS = 60;
/** |z| at or above this = significant. */
export const MOVE_Z = 2;

export type PriceMove = {
  /** `<symbol>:<start date>`. */
  id: string;
  symbol: string;
  startDay: string;
  endDay: string;
  /** Trading days in the move. */
  days: number;
  /** Close before the move started, close at its end (stored units). */
  closeBefore: number;
  closeEnd: number;
  /** The stock's return over the move, the S&P 500's over the same span, and the cumulative abnormal return (ratios). */
  returnPct: number;
  benchReturn: number | null;
  abnormal: number;
  /** Cumulative abnormal return / (trailing standard deviation x sqrt(days)). */
  z: number;
  beta: number;
  direction: "up" | "down";
};

/** One day's reading (exported for tests). */
export type DayReturn = { day: string; prevClose: number; close: number; ret: number; bench: number | null; abnormal: number; z: number | null; beta: number };

/** Last benchmark close on or before each stock day (holidays differ across markets). */
function benchOnOrBefore(bench: Bar[]): (day: string) => number | null {
  return (day: string) => {
    let lo = 0;
    let hi = bench.length - 1;
    let out: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bench[mid].date <= day) {
        out = bench[mid].close;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return out;
  };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
function sd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
}

/** OLS slope of y on x; null when x has no variance. Clamped to [0, 2]: a regression on noisy small caps can swing wildly. */
function betaOf(ys: number[], xs: number[]): number | null {
  if (xs.length < MOVE_MIN_DAYS) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
  }
  if (!(vx > 1e-12)) return null;
  return Math.min(2, Math.max(0, cov / vx));
}

/** Every trading day's abnormal return and z-score, oldest first. Bars sorted oldest first, one unit per series. */
export function dailyAbnormal(bars: Bar[], bench: Bar[]): DayReturn[] {
  const benchAt = benchOnOrBefore(bench);
  const raw: { day: string; prevClose: number; close: number; ret: number; bench: number | null }[] = [];
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1];
    const b = bars[i];
    if (!(p.close > 0) || !(b.close > 0)) continue;
    const b0 = benchAt(p.date);
    const b1 = benchAt(b.date);
    raw.push({ day: b.date, prevClose: p.close, close: b.close, ret: b.close / p.close - 1, bench: b0 && b1 ? b1 / b0 - 1 : null });
  }
  const out: DayReturn[] = [];
  for (let i = 0; i < raw.length; i++) {
    const past = raw.slice(Math.max(0, i - MOVE_WINDOW_DAYS), i);
    const paired = past.filter((d) => d.bench !== null);
    const beta = betaOf(paired.map((d) => d.ret), paired.map((d) => d.bench as number)) ?? 1;
    const ab = (d: (typeof raw)[number]) => d.ret - beta * (d.bench ?? 0);
    const pastAb = past.map(ab);
    const s = pastAb.length >= MOVE_MIN_DAYS ? sd(pastAb) : null;
    const abnormal = ab(raw[i]);
    out.push({ ...raw[i], abnormal, beta, z: s && s > 0 ? abnormal / s : null });
  }
  return out;
}

/** The significant moves of a stock, oldest first: |z| >= 2 days, consecutive same-sign days merged into one move. */
export function findMoves(symbol: string, bars: Bar[], bench: Bar[]): PriceMove[] {
  const days = dailyAbnormal(bars, bench);
  const benchAt = benchOnOrBefore(bench);
  const moves: PriceMove[] = [];
  let run: DayReturn[] = [];
  const close = () => {
    if (run.length === 0) return;
    const first = run[0];
    const last = run[run.length - 1];
    const abnormal = run.reduce((s, d) => s + d.abnormal, 0);
    // The run's own volatility unit: its first day's z gives the trailing standard deviation back.
    const unit = first.z ? first.abnormal / first.z : 0;
    const prevDay = days[days.indexOf(first) - 1]?.day ?? null;
    const b0 = prevDay ? benchAt(prevDay) : null;
    const b1 = benchAt(last.day);
    moves.push({
      id: `${symbol}:${first.day}`,
      symbol,
      startDay: first.day,
      endDay: last.day,
      days: run.length,
      closeBefore: first.prevClose,
      closeEnd: last.close,
      returnPct: last.close / first.prevClose - 1,
      benchReturn: b0 && b1 ? b1 / b0 - 1 : null,
      abnormal,
      z: unit > 0 ? abnormal / (unit * Math.sqrt(run.length)) : (first.z ?? 0),
      beta: first.beta,
      direction: abnormal >= 0 ? "up" : "down",
    });
    run = [];
  };
  for (const d of days) {
    const significant = d.z !== null && Math.abs(d.z) >= MOVE_Z;
    if (significant && run.length > 0 && Math.sign(d.abnormal) === Math.sign(run[0].abnormal)) run.push(d);
    else {
      close();
      if (significant) run.push(d);
    }
  }
  close();
  return moves;
}
