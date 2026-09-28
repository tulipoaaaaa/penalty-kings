/**
 * Target Practice / Crossbar Challenge: 60-second score attack, no keeper. Targets move across the
 * goal on seeded paths; top-bin targets are worth 5×; hitting the crossbar is a bonus; consecutive
 * hits build a combo (up to ×5), any miss resets it. Pure and deterministic given the seed.
 */
import { prng, shotTarget, type ShotInput } from "@penalty-kings/engine";

export const TARGET_SECONDS = 60, MAX_COMBO = 5, CROSSBAR_BONUS = 250;
/**
 * What the shared game clock sees this frame. `frozen`: paused, the rotate card (BQ-P1-4) or a hidden tab;
 * `overlay`: a pack reveal or the ball carousel; `moment`: a protected Stage moment (walkout, replay, walk-on).
 */
export type ClockGate = { kind: string; frozen: boolean; menu: boolean; overlay: boolean; moment: boolean; inFlight: boolean };
/**
 * Does the game clock (shot clock, Target Practice countdown) advance this frame? Target Practice's "60 seconds"
 * is a real minute: it keeps running through the flight, the result banner and Stage moments, and stops only for
 * menus, overlays, pause, the rotate card and a hidden tab. Other modes also stop for protected Stage moments.
 */
export function gameClockRunning(gate: ClockGate) {
  if (gate.frozen || gate.menu || gate.overlay) return false;
  return gate.kind === "target" || !gate.moment;
}
export type Target = { id: number; x: number; y: number; r: number; speed: number; phase: number; value: 1 | 2 | 5 };

export function spawnTargets(seed: number, round: number): Target[] {
  const random = prng((seed + round * 7919) >>> 0);
  return Array.from({ length: 3 }, (_, index) => {
    const bin = random() < 0.3;
    return {
      id: round * 10 + index,
      x: (random() * 2 - 1) * 0.7, y: bin ? 0.82 : 0.2 + random() * 0.5,
      r: bin ? 0.13 : 0.17 + random() * 0.06, speed: 0.25 + random() * 0.5 + round * 0.02, phase: random() * Math.PI * 2,
      value: bin ? 5 : random() < 0.4 ? 2 : 1,
    };
  });
}

/** Target centre at time t: swings across the goal (bins also swing, near the top corners). */
export function targetAt(target: Target, t: number) {
  const swing = Math.sin(target.phase + t * target.speed * 2);
  return target.value === 5 ? { x: Math.sign(swing || 1) * (0.72 + 0.12 * Math.abs(swing)), y: target.y } : { x: swing * 0.75, y: target.y };
}

export type TargetHit = { hit: Target | null; crossbar: boolean; points: number; combo: number; x: number; y: number };

/**
 * Resolve one kick released at time t (seconds of target motion) against the live targets.
 * `delay` is how long after release the ball crosses the goal line ON SCREEN (the shell passes the
 * Stage's strike + flight time), so the hit is judged on the target positions drawn at that moment.
 * The targets keep moving during the flight. Defaults to the engine's physical flight time.
 */
export function resolveTargetShot(shot: ShotInput, targets: readonly Target[], t: number, combo: number, delay?: number): TargetHit {
  const crossing = shotTarget(shot);
  const arrive = t + (delay ?? crossing.time);
  const crossbar = Math.abs(crossing.y - 1) < 0.07 && Math.abs(crossing.x) < 1;
  const hit = targets.find(target => { const at = targetAt(target, arrive); return Math.hypot(crossing.x - at.x, crossing.y - at.y) < target.r; }) ?? null;
  const nextCombo = hit || crossbar ? Math.min(MAX_COMBO, combo + 1) : 0;
  const points = (hit ? 100 * hit.value : 0) * Math.max(1, nextCombo) + (crossbar ? CROSSBAR_BONUS : 0);
  return { hit, crossbar, points, combo: nextCombo, x: crossing.x, y: crossing.y };
}
