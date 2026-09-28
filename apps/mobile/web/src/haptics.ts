/**
 * Haptics bridge. The game already asks for a short buzz on the kick (navigator.vibrate(15)) and a double buzz on
 * a goal (navigator.vibrate([40, 30, 40])), when its "Vibration" setting is on. In the test app the game frame
 * forwards those requests to the shell (frame-bridge.js), which plays them:
 *   native app  → Capacitor Haptics (impact on the kick, success notification on a goal; iPhone included);
 *   web         → navigator.vibrate where the browser has it (Android Chrome);
 *   iPhone web  → nothing (Safari has no vibration API): a silent no-op, never an error.
 */

export type HapticKind = "kick" | "goal";

/** The game's own patterns: a single short pulse is the kick, a pattern (array) is the goal. */
export function hapticKind(pattern: unknown): HapticKind | null {
  if (typeof pattern === "number" && Number.isFinite(pattern) && pattern > 0 && pattern <= 1000) return "kick";
  if (Array.isArray(pattern) && pattern.length > 0 && pattern.length <= 8 && pattern.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000)) return "goal";
  return null;
}

export const WEB_PATTERNS: Record<HapticKind, number | number[]> = { kick: 15, goal: [40, 30, 40] };

export type HapticsDeps = {
  /** Native haptics (Capacitor), or null outside the native app. */
  native: null | {
    impact(options: { style: "LIGHT" | "MEDIUM" | "HEAVY" }): Promise<void>;
    notification(options: { type: "SUCCESS" | "WARNING" | "ERROR" }): Promise<void>;
  };
  /** navigator.vibrate bound to navigator, or null/undefined when the browser has none (iPhone Safari). */
  vibrate?: ((pattern: number | number[]) => boolean) | null;
};

export type HapticsBridge = {
  play(kind: HapticKind): Promise<"native" | "vibrate" | "none">;
};

export function createHaptics(deps: HapticsDeps): HapticsBridge {
  return {
    async play(kind) {
      if (deps.native) {
        try {
          if (kind === "goal") await deps.native.notification({ type: "SUCCESS" });
          else await deps.native.impact({ style: "LIGHT" });
          return "native";
        } catch { /* fall through to the web fallback */ }
      }
      if (typeof deps.vibrate === "function") {
        try { return deps.vibrate(WEB_PATTERNS[kind]) ? "vibrate" : "none"; } catch { return "none"; }
      }
      return "none";
    },
  };
}
