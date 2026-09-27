/**
 * C3c: the Golden Boot Cup pot, impossible to miss (presentation only: every figure comes from game/prizes.ts).
 *  • useCountUp: the pot ticks up to its new value (static under reduced motion) and flags each growth;
 *  • PotCounter: the pot line on title, modes and Results, with the Cup draw countdown and the Champions Night strip;
 *  • WinnersTicker: last week's winners (SIMULATED, generic Friend numbers and original pixel badges).
 */
import { useEffect, useRef, useState } from "react";
import type { PrizeLine } from "./game/prizes.js";
import { countUpValue, lastWeekWinners, type Winner } from "./game/weekly.js";

/** How long a count-up takes, and how long the glow stays on after the pot grows. */
export const COUNT_UP_MS = 1200, GLOW_MS = 1500;

/** The value to show while counting up to `target`; `grew` changes every time the target grows (glow + sound). */
export function useCountUp(target: number, reduced: boolean) {
  const [shown, setShown] = useState(target), [grew, setGrew] = useState(0);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (target === start) return;
    if (target > start) setGrew(count => count + 1);
    if (reduced || target < start || typeof requestAnimationFrame === "undefined") { from.current = target; setShown(target); return; }
    const began = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const k = (time - began) / COUNT_UP_MS, value = k >= 1 ? target : countUpValue(start, target, k);
      from.current = value; setShown(value);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);
  return { shown, grew };
}

/** True for GLOW_MS after each growth (the key changes). */
export function useGlow(key: number) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!key) return;
    setOn(true);
    const id = window.setTimeout(() => setOn(false), GLOW_MS);
    return () => window.clearTimeout(id);
  }, [key]);
  return on;
}

/** The pot line: pot, ≈ USD, SIMULATED/LIVE, then the Cup draw countdown and the Champions Night strip. With `onOpen` it is a button (tap = the odds, like the HUD banner). */
export function PotCounter({ pot, draw, night, nightActive, glow, place, onOpen }: {
  pot: PrizeLine; draw: string; night: string; nightActive: boolean; glow: boolean; place: "title" | "modes" | "results"; onOpen?: () => void;
}) {
  const data = { className: "pk-potline", "data-testid": "pot-counter", "data-place": place, "data-glow": glow || undefined, "data-tag": pot.tag };
  const body = <>
    <span className="pk-potline-main"><span className="pk-potline-label">GOLDEN BOOT CUP</span> <b data-testid="pot-counter-value">🏆 {pot.value}</b> <span className="pk-potline-usd">{pot.usd}</span>{" "}
      {pot.tag === "SIMULATED" ? <b className="pk-simtag">SIMULATED</b> : <small>{pot.note}</small>}</span>
    <span className="pk-potline-sub"><span data-testid="cup-draw">{draw}</span> · <span className="pk-night" data-testid="champions-night" data-active={nightActive}>{night}</span></span>
  </>;
  return onOpen ? <button type="button" {...data} onClick={onOpen} title="Tap for the exact odds and the 90% average return">{body}</button>
    : <div {...data} role="group" aria-label="Golden Boot Cup">{body}</div>;
}

/** An original 8 × 8 pixel Friend badge (a round head, two eyes, a colour per badge): no real Friend art. */
const BADGE_COLOURS = ["#ffd23f", "#7fd3ff", "#ccff00", "#ff5a6e", "#c9a0ff", "#ffa94d"];
function Badge({ index }: { index: number }) {
  return <svg className="pk-badge-px" viewBox="0 0 8 8" width="16" height="16" aria-hidden="true" shapeRendering="crispEdges">
    <path fill={BADGE_COLOURS[index % BADGE_COLOURS.length]} d="M2 0h4v1h1v1h1v4h-1v1h-1v1h-4v-1h-1v-1h-1v-4h1v-1h1z" />
    <path fill="#0b0d1a" d="M2 3h1v2h-1zM5 3h1v2h-1zM3 6h2v1h-2z" />
  </svg>;
}

/** "Last week's winners" (SIMULATED): a slow marquee; reduced motion shows the top three, still. */
export function WinnersTicker({ now, reduced, simulated }: { now: number; reduced: boolean; simulated: boolean }) {
  if (!simulated) return null; // live: the weekly Cup report publishes the real winners (docs/WEEKLY.md)
  const winners = lastWeekWinners(now);
  const item = (winner: Winner) => <span key={winner.rank} className="pk-winner"><Badge index={winner.badge} />#{winner.rank} {winner.name} <b>{winner.amountRF.toLocaleString("en-US")} RF</b></span>;
  return <div className="pk-winners" data-testid="winners" data-still={reduced || undefined} role="group" aria-label="Last week's Cup winners (simulated)">
    <span className="pk-winners-head">LAST WEEK <b className="pk-simtag">SIMULATED</b></span>
    <div className="pk-winners-track">
      <div className="pk-winners-run">
        <span className="pk-winners-set">{(reduced ? winners.slice(0, 3) : winners).map(item)}</span>
        {!reduced && <span className="pk-winners-set" aria-hidden="true">{winners.map(item)}</span>}
      </div>
    </div>
  </div>;
}
