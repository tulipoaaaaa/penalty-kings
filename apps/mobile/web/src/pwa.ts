/** PWA plumbing: service worker (offline + "New version — tap to reload"), audio unlock on first tap. */

export type UpdateListener = (apply: () => void) => void;

/** Registers ./sw.js (relative, so any base path works). Calls onUpdate when a new version is waiting. */
export function registerServiceWorker(onUpdate: UpdateListener) {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  // The native app (Capacitor) ships every file inside the APK / .ipa and updates by reinstalling: no service worker
  // (Android serves the bundle from https://localhost, where a worker would only add a second cache).
  if ((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) return;
  let reloading = false;
  const offer = (worker: ServiceWorker) => onUpdate(() => {
    reloading = true;
    worker.postMessage({ type: "SKIP_WAITING" });
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloading) location.reload(); });
  navigator.serviceWorker.register("./sw.js").then(registration => {
    // A version already waiting (installed while the app was open earlier).
    if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) offer(worker);
      });
    });
    // Look for a new version when the app comes back to the foreground.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void registration.update().catch(() => undefined); });
  }).catch(() => { /* offline-first is best effort: the app still runs without a service worker */ });
}

/**
 * iOS/Safari keep Web Audio suspended until a user gesture. The shell resumes a shared AudioContext on the first
 * tap (and plays one silent frame, which unlocks the page's audio session on iOS). The game frame unlocks its own
 * synthesised audio on its first tap (games/penalty-kings/audio.ts, unchanged).
 */
export function installAudioUnlock() {
  const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const unlock = () => {
    try {
      const ctx = new Ctx();
      const buffer = ctx.createBuffer(1, 1, 22050), source = ctx.createBufferSource();
      source.buffer = buffer; source.connect(ctx.destination); source.start(0);
      void ctx.resume().finally(() => { (window as unknown as { __pkTestAudio?: string }).__pkTestAudio = ctx.state; });
    } catch { /* audio is optional */ }
    for (const type of ["pointerdown", "touchend", "keydown"]) removeEventListener(type, unlock, true);
  };
  for (const type of ["pointerdown", "touchend", "keydown"]) addEventListener(type, unlock, { capture: true, passive: true });
}
