/**
 * The native shell bridge (Capacitor, apps/mobile/android + apps/mobile/ios). In a browser (the PWA and the
 * Playwright runs) every native call is skipped and the web fallbacks run instead, so the web build behaves as before.
 *
 *   - game frame ↔ shell messages (frame-bridge.js inside the sandboxed game): haptics requests and the game's state;
 *   - haptics on the kick / goal (haptics.ts);
 *   - Android back button → decideBack (back.ts);
 *   - while playing: landscape lock, keep-awake, system bars hidden (full screen);
 *   - OAuth deep-link return com.penaltykings.test://auth (deeplink.ts).
 *
 * Plugins are reached through registerPlugin with no web implementation (their JS packages are only needed for the
 * types): the native side registers them (cap sync), the web build never calls them.
 */
import { Capacitor, registerPlugin, SystemBars } from "@capacitor/core";
import type { AppPlugin } from "@capacitor/app";
import type { HapticsPlugin, ImpactStyle, NotificationType } from "@capacitor/haptics";
import type { ScreenOrientationPlugin } from "@capacitor/screen-orientation";
import type { KeepAwakePlugin } from "@capacitor-community/keep-awake";
import { parseGameView, type GameView } from "./back.ts";
import { authReturnSearch } from "./deeplink.ts";
import { createHaptics, hapticKind, type HapticKind } from "./haptics.ts";

export const isNative = (): boolean => { try { return Capacitor.isNativePlatform(); } catch { return false; } };
export const nativePlatform = (): string => { try { return Capacitor.getPlatform(); } catch { return "web"; } };

const App = registerPlugin<AppPlugin>("App");
const Haptics = registerPlugin<HapticsPlugin>("Haptics");
const ScreenOrientation = registerPlugin<ScreenOrientationPlugin>("ScreenOrientation");
const KeepAwake = registerPlugin<KeepAwakePlugin>("KeepAwake");
const quiet = (promise: Promise<unknown> | undefined) => { void promise?.catch(() => undefined); };

type TestHooks = { __pkTestHaptics?: { kind: HapticKind; via: string }[]; __pkTestGame?: GameView | null };
const hooks = globalThis as TestHooks;

const haptics = createHaptics({
  native: isNative() ? {
    impact: options => Haptics.impact({ style: options.style as ImpactStyle }),
    notification: options => Haptics.notification({ type: options.type as NotificationType }),
  } : null,
  vibrate: typeof navigator !== "undefined" && typeof navigator.vibrate === "function" ? navigator.vibrate.bind(navigator) : null,
});

/** The sandboxed game frame's window (the SDK host renders one iframe[sandbox]). */
const gameWindow = () => document.querySelector<HTMLIFrameElement>("iframe[sandbox]")?.contentWindow ?? null;

/** Sends a command to the game frame (frame-bridge.js): "close-overlay" or "to-modes". */
export function tellGame(command: "close-overlay" | "to-modes") {
  gameWindow()?.postMessage({ pkTestNative: { type: command } }, "*");
}

/**
 * Listens to the game frame: haptics requests and state reports. Only messages whose source is the game frame's
 * window and whose shape is exact are used; everything else (the SDK's own bridge messages included) is ignored.
 */
export function listenToGame(onGame: (view: GameView | null) => void) {
  const listener = (event: MessageEvent) => {
    const data = (event.data as { pkTestNative?: { type?: unknown; pattern?: unknown; view?: unknown } } | null)?.pkTestNative;
    if (!data || typeof data !== "object" || event.source === null || event.source !== gameWindow()) return;
    if (data.type === "haptic") {
      const kind = hapticKind(data.pattern);
      if (kind) void haptics.play(kind).then(via => { (hooks.__pkTestHaptics ??= []).push({ kind, via }); });
    } else if (data.type === "state") {
      const view = parseGameView(data.view);
      if (view) { hooks.__pkTestGame = view; onGame(view); }
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

let playing: boolean | null = null;
/** Landscape lock + keep-awake + hidden system bars while the game is on screen; released in onboarding. */
export function setPlaying(next: boolean) {
  if (!isNative() || playing === next) return;
  playing = next;
  if (next) {
    quiet(ScreenOrientation.lock({ orientation: "landscape" }));
    quiet(KeepAwake.keepAwake());
    quiet(SystemBars.hide());
  } else {
    quiet(ScreenOrientation.unlock());
    quiet(KeepAwake.allowSleep());
  }
}

/** Android back button, deep-link return and resume handling (native only). Returns an unsubscribe function. */
export function installNative({ onBack }: { onBack: () => void }) {
  if (!isNative()) return () => undefined;
  const handles: Promise<{ remove: () => Promise<void> }>[] = [];
  // Registering a backButton listener turns off Capacitor's default (history back / exit): the app decides.
  handles.push(App.addListener("backButton", () => onBack()));
  handles.push(App.addListener("appUrlOpen", ({ url }) => {
    const search = authReturnSearch(url);
    if (search) location.replace(`${location.pathname}${search}`);
  }));
  handles.push(App.addListener("resume", () => {
    quiet(SystemBars.hide());
    if (playing) { quiet(KeepAwake.keepAwake()); quiet(ScreenOrientation.lock({ orientation: "landscape" })); }
  }));
  quiet(SystemBars.hide());
  return () => { for (const handle of handles) void handle.then(h => h.remove()).catch(() => undefined); };
}

/** Android: send the app to the background (never a hard exit). No-op on the web. */
export function toBackground() {
  if (isNative() && nativePlatform() === "android") quiet(App.minimizeApp());
}
