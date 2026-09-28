// TEST BUILD: the game frame's side of the shell bridge (inlined into game/frame.html by scripts/build-test-app.mjs,
// allowed by its SHA-256 hash in the frame's CSP). The game source is unchanged: this reads the game's read-only QA
// hook (window.__pkFlow) and uses its own buttons. It only ever talks to its parent window, with { pkTestNative } messages:
//   → parent  { type: "haptic", pattern }       the game's navigator.vibrate(…) requests (kick 15 / goal [40,30,40])
//   → parent  { type: "state", view }           { screen, overlay, session } whenever it changes
//   ← parent  { type: "close-overlay" }         close the open game menu / pack / ball picker / share card
//   ← parent  { type: "to-modes" }              leave the running session → Modes (the shell asked the player first)
(() => {
  const post = message => { try { parent.postMessage({ pkTestNative: message }, "*"); } catch { /* no parent */ } };
  const vibrate = pattern => { post({ type: "haptic", pattern }); return true; };
  try { Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true }); } catch { /* keep the browser's own */ }

  const overlayOpen = () => Boolean(document.querySelector(".rf-frame-menu, [data-testid=pack], [data-testid=carousel], [data-testid=share-dialog]"));
  const view = () => {
    let flow = null;
    try { flow = typeof window.__pkFlow === "function" ? window.__pkFlow() : null; } catch { flow = null; }
    if (!flow || !["title", "modes", "play"].includes(flow.screen)) return null;
    return { screen: flow.screen, overlay: Boolean(flow.menu || flow.pack || flow.carousel) || overlayOpen(), session: Boolean(flow.session) };
  };
  let last = "";
  setInterval(() => {
    const next = view();
    const key = JSON.stringify(next);
    if (next && key !== last) { last = key; post({ type: "state", view: next }); }
  }, 200);

  const click = element => { if (element && !element.disabled) { element.click(); return true; } return false; };
  const later = (fn, tries = 60) => { if (!fn() && tries > 0) setTimeout(() => later(fn, tries - 1), 120); };
  const closeOverlay = () => {
    const menus = [...document.querySelectorAll(".rf-frame-menu")];
    const top = menus[menus.length - 1];
    if (top && click(top.querySelector("header button[aria-label^='Close']"))) return true;
    const target = top ?? document.querySelector("[data-testid=share-dialog], [data-testid=carousel], [data-testid=pack]") ?? document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    return true;
  };
  const changeMode = () => [...document.querySelectorAll(".rf-frame-menu button")].find(button => button.textContent.trim() === "Change mode" || button.textContent.trim() === "Modes");
  const toModes = () => later(() => {
    const flow = view();
    if (!flow || flow.screen !== "play") return true;
    const button = changeMode();
    if (button) return click(button) && false;          // clicked: check again on the next try
    if (flow.overlay) { closeOverlay(); return false; } // another menu is open: close it, then open the hub
    click(document.querySelector("[data-testid=menu]"));  // the HUD "Menu" (disabled while the ball is in flight)
    return false;
  });

  addEventListener("message", event => {
    if (event.source !== parent) return;
    const type = event.data && event.data.pkTestNative && event.data.pkTestNative.type;
    if (type === "close-overlay") closeOverlay();
    else if (type === "to-modes") toModes();
  });
})();
