/**
 * B9 UI feel: the count-up on the Results reward tiles (XP, points, goals, and Big Match RF / $GBOOT / Cup race figures).
 * Pure presentation: the true figure is decided before Results open; these helpers only choose what to show on the way
 * there, and always END on the exact final value (the final text is returned verbatim at t ≥ 1).
 */

/** How long the Results count-up takes, and how many rising ticks play along the way (rarity-0 … rarity-6 chimes). */
export const COUNT_UP_MS = 800, COUNT_TICKS = 7;

/** Ease-out cubic on t ∈ [0, 1] (clamped; NaN counts as 0). */
export const easeOut = (t: number) => { const k = t > 0 ? Math.min(1, t) : 0; return 1 - (1 - k) ** 3; };

/**
 * The value to show at progress t ∈ [0, 1] counting from → to, in whole steps of `step` (1 = integers, 0.01 = cents):
 * eased, never past `to`, monotonic in t, and exactly `to` at t ≥ 1.
 */
export function countUp(from: number, to: number, t: number, step = 1): number {
  if (!(t > 0)) return from; // t ≤ 0 or NaN
  if (t >= 1) return to;
  const units = Math.round((to - from) / step), done = Math.trunc(units * easeOut(t));
  const value = from + done * step;
  return step >= 1 ? value : Number(value.toFixed(decimalsOf(step)));
}

/** How many ticks have played by progress t (0 … COUNT_TICKS; the last one on t = 1). */
export const ticksAt = (t: number, ticks = COUNT_TICKS) => (t >= 1 ? ticks : Math.max(0, Math.floor(Math.min(1, t) * ticks)));

const decimalsOf = (step: number) => Math.max(0, Math.round(-Math.log10(step)));

/**
 * A formatted figure part-way through its count-up, in the same format as its final text ("1,234.5", "+12", "0.25"):
 * digits after the point and thousands separators follow the final text; at t ≥ 1 it IS the final text.
 * Text that is not a plain number is returned unchanged.
 */
export function countUpText(final: string, t: number): string {
  if (!(t < 1)) return final;
  const match = /^([^\d-]*)(-?[\d,]*\d(?:\.(\d+))?)(.*)$/.exec(final);
  if (!match) return final;
  const [, before, number, fraction = "", after] = match, target = Number(number.replace(/,/g, ""));
  if (!Number.isFinite(target)) return final;
  const decimals = fraction.length, value = countUp(0, target, t, 10 ** -decimals);
  const text = value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: number.includes(",") });
  return `${before}${text}${after}`;
}
