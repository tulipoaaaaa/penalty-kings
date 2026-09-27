"use client";
// Phone layout helpers (R6-B7). The sandboxed game cannot read the host page's orientation, so it decides from
// its own frame: a ResizeObserver on the game root (.pk) reports the frame size, and a portrait frame on a
// phone-sized screen shows "Turn your phone sideways". The portrait layout works (style.css, @container
// orientation: portrait), so the overlay offers "Play in portrait anyway" and remembers that for the session.
import { useLayoutEffect, useRef, useState } from "react";

/** Portrait = taller than wide by a margin (no flicker on near-square frames), on a phone-sized frame. */
export function isPortraitFrame(width: number, height: number): boolean {
  return width > 0 && width <= 700 && height > width * 1.1;
}

/** A 12 × 20 pixel phone, drawn as SVG rects (like the menu icons: original art, no icon font). */
function PhoneIcon() {
  const px: [number, number, number, number, string][] = [
    [1, 0, 10, 1, "#f7f7f2"], [0, 1, 1, 18, "#f7f7f2"], [11, 1, 1, 18, "#f7f7f2"], [1, 19, 10, 1, "#f7f7f2"],
    [1, 1, 10, 2, "#2a3160"], [1, 16, 10, 3, "#2a3160"], [5, 17, 2, 1, "#f7f7f2"], [4, 1.5, 4, 1, "#0b0d1a"],
    [1, 3, 10, 13, "#2e7d32"], [1, 9, 10, 1, "#37903b"], [4, 4, 4, 2, "#f7f7f2"], [5, 12, 2, 2, "#f7f7f2"],
  ];
  return <svg className="pk-rotate-phone" viewBox="0 0 12 20" width="48" height="80" aria-hidden="true" shapeRendering="crispEdges">
    {px.map(([x, y, w, h, fill], index) => <rect key={index} x={x} y={y} width={w} height={h} fill={fill} />)}
  </svg>;
}

/** Full-frame "Turn your phone sideways" card over a portrait frame, until the player chooses portrait. */
export function RotateOverlay() {
  const node = useRef<HTMLDivElement>(null);
  const [portrait, setPortrait] = useState(false);
  const [stay, setStay] = useState(false);
  useLayoutEffect(() => {
    const root = node.current?.closest(".pk") as HTMLElement | null;
    if (!root) return;
    const measure = () => { const box = root.getBoundingClientRect(); setPortrait(isPortraitFrame(box.width, box.height)); };
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const show = portrait && !stay;
  return <div ref={node} className="pk-rotate" hidden={!show} role="dialog" aria-modal="true" aria-label="Turn your phone sideways" data-testid="rotate">
    {show && <>
      <PhoneIcon />
      <strong>Turn your phone sideways</strong>
      <p>Penalty Kings plays best in landscape: a bigger goal and more room to swipe.</p>
      <button type="button" onClick={() => setStay(true)} data-testid="portrait-anyway">Play in portrait anyway</button>
    </>}
  </div>;
}
