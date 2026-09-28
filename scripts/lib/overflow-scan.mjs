// In-page layout scanner for scripts/test-overflow.mjs. `overflowScan` is serialised into the page (Playwright
// evaluate), so it must stay self-contained: no imports, no closures over module scope.
//
// Checks, per visible element (display:none / visibility:hidden / opacity 0 / zero-size / sr-only are skipped):
//   escape      text (each word's rect, via Range.getClientRects) outside the border box of its nearest boxed
//               ancestor (a visible background or border): e.g. a wrapped 2nd line hanging under a button.
//   clipped     text cut off by an overflow:hidden/clip ancestor (content the player cannot see or scroll to);
//               an ellipsis or line-clamp truncation is reported as `ellipsis` with the full text.
//   overlap     two visible controls overlapping, or two text runs overlapping, in the same layer group (a modal
//               over the stage is intentional stacking: only elements under the same occluding dialog are compared).
//   offscreen   a control or text outside the viewport with no scroll path to it (an overflow:auto/scroll ancestor
//               that is itself on screen, or a scrollable document); a scroll container that is itself off screen.
//   hscroll     the document is wider than the viewport.
//   small-font  visible on-screen text under `minFont` CSS px.        small-tap  a control under `minTap` CSS px.
// A vertical allowance of (glyph box − line-height) / 2 is given to every word: a tight line-height (e.g. 1) makes the
// Range rect taller than the line box without any visible overflow.
export function overflowScan({ minFont = 11, minTap = 44, tol = 1, ignore = [] } = {}) {
  const vw = innerWidth, vh = innerHeight, findings = [];
  const styles = new Map(), rects = new Map();
  const style = el => { let s = styles.get(el); if (!s) { s = getComputedStyle(el); styles.set(el, s); } return s; };
  const rect = el => { let r = rects.get(el); if (!r) { r = el.getBoundingClientRect(); rects.set(el, r); } return r; };
  const alpha = colour => {
    if (!colour || colour === "transparent") return 0;
    const m = colour.match(/\(([^)]*)\)/); if (!m) return 1;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length >= 4 ? (parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
  };
  const boxed = el => {
    const s = style(el);
    if (alpha(s.backgroundColor) > 0.05 || s.backgroundImage !== "none") return true;
    for (const side of ["Top", "Right", "Bottom", "Left"]) if (parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== "none" && alpha(s[`border${side}Color`]) > 0.05) return true;
    return false;
  };
  const one = el => {
    let sig = el.tagName.toLowerCase();
    const classes = [...el.classList].filter(name => !/^(pk-(goal|miss|save|good|bad|gain|loss|reduce-motion|coldopen|stadium-.*)|is-.*)$/.test(name));
    sig += classes.map(name => `.${name}`).join("");
    const id = el.getAttribute("data-testid"); if (id) sig += `[data-testid=${id.replace(/\d+/g, "N")}]`;
    return sig;
  };
  /** A root-cause selector: up to two classed ancestors, then the element. */
  const sel = el => {
    const chain = [];
    for (let a = el.parentElement; a && a !== document.body && chain.length < 2; a = a.parentElement) if (a.classList.length || a.hasAttribute("data-testid")) chain.unshift(one(a));
    return [...chain, one(el)].join(" ");
  };
  const textOf = el => (el.innerText || el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const box = r => ({ x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
  const ignored = (check, el) => ignore.some(rule => (rule.check === "*" || rule.check === check) && el.closest(rule.selector));
  const add = (check, el, detail, extra = {}) => { if (!ignored(check, el)) findings.push({ check, sel: sel(el), text: textOf(el), detail, ...extra, rect: box(extra.rect ?? rect(el)) }); };
  const visible = el => el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  const inViewport = r => r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
  const docScroll = {
    x: style(document.documentElement).overflowX !== "hidden" && style(document.body).overflowX !== "hidden" && document.documentElement.scrollWidth > vw + 1,
    y: style(document.documentElement).overflowY !== "hidden" && style(document.body).overflowY !== "hidden" && document.documentElement.scrollHeight > vh + 1,
  };
  const scrolls = (el, axis) => { const s = style(el), o = axis === "x" ? s.overflowX : s.overflowY; return (o === "auto" || o === "scroll") && (axis === "x" ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1); };
  const clips = (el, axis) => { const o = axis === "x" ? style(el).overflowX : style(el).overflowY; return o === "hidden" || o === "clip"; };
  const padBox = el => { const r = rect(el); return { left: r.left + el.clientLeft, top: r.top + el.clientTop, right: r.left + el.clientLeft + el.clientWidth, bottom: r.top + el.clientTop + el.clientHeight }; };
  /** A scroll path to rect r on `axis`: an on-screen scrollable ancestor, or a scrollable document. */
  const scrollPath = (el, axis) => {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      if (scrolls(a, axis)) { const r = rect(a); return r.left >= -tol && r.top >= -tol && r.right <= vw + tol && r.bottom <= vh + tol ? "container" : "container-offscreen"; }
    }
    return docScroll[axis] ? "document" : null;
  };
  /** The occluding layer an element belongs to: the nearest dialog-like ancestor that covers ≥ 60 % of the view with an opaque-ish backdrop. */
  const groups = new Map();
  const group = el => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      if (groups.has(a)) return groups.get(a);
      const role = a.getAttribute("role"), s = style(a), r = rect(a);
      if ((role === "dialog" || role === "alertdialog" || a.getAttribute("aria-modal") === "true" || s.position === "fixed" || (s.position === "absolute" && r.width * r.height >= 0.6 * vw * vh)) && r.width * r.height >= 0.6 * vw * vh && alpha(s.backgroundColor) >= 0.5) { groups.set(a, a); return a; }
    }
    return document.body;
  };
  /** The part of el's box not clipped away by overflow ancestors (what can actually be seen / hit). */
  const visRect = el => {
    const r = rect(el), v = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = style(a);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const p = padBox(a);
      if (s.overflowX !== "visible") { v.left = Math.max(v.left, p.left); v.right = Math.min(v.right, p.right); }
      if (s.overflowY !== "visible") { v.top = Math.max(v.top, p.top); v.bottom = Math.min(v.bottom, p.bottom); }
    }
    return v.right > v.left && v.bottom > v.top ? v : null;
  };
  /** A 3D flip card's face turned away (backface-visibility: hidden under an odd number of Y flips): not seen. */
  const flipped = el => { const t = style(el).transform; return t && t !== "none" && new DOMMatrix(t).m11 < 0; };
  const backHidden = el => {
    for (let h = el; h && h !== document.body; h = h.parentElement) {
      if (style(h).backfaceVisibility !== "hidden") continue;
      let turns = 0;
      for (let a = h; a && a !== document.body; a = a.parentElement) if (flipped(a)) turns++;
      if (turns % 2) return true;
    }
    return false;
  };
  /** Scrolled under a sticky/fixed opaque bar (e.g. the Results footer): hidden content with a scroll path, not a collision. */
  const pinned = el => { for (let a = el; a && a !== document.body; a = a.parentElement) { const p = style(a).position; if ((p === "sticky" || p === "fixed") && alpha(style(a).backgroundColor) >= 0.9) return a; } return null; };
  const scrollerOf = el => { for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) if (scrolls(a, "y") || scrolls(a, "x")) return a; return null; };
  const underPin = (x, y) => { const px = pinned(x), py = pinned(y); if (px === py) return false; const pin = px ?? py, other = px ? y : x; const s = scrollerOf(pin); return Boolean(s && s.contains(other) && !pin.contains(other)); };
  const inert = el => Boolean(el.closest("[inert]"));
  const srOnly = el => { for (let a = el, i = 0; a && i < 4; a = a.parentElement, i++) { const r = rect(a); if ((r.width <= 2 || r.height <= 2) && (clips(a, "x") || clips(a, "y"))) return true; } return false; };

  // ── Text runs: every visible word's rects ─────────────────────────────────
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "OPTION", "SELECT", "INPUT", "TITLE", "svg"]);
  const runs = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.data.trim()) continue;
    const parent = node.parentElement;
    if (!parent || SKIP.has(parent.tagName) || parent.closest("svg, [aria-hidden=true] canvas") || !visible(parent) || srOnly(parent) || backHidden(parent)) continue;
    const s = style(parent), fontSize = parseFloat(s.fontSize), lineHeight = s.lineHeight === "normal" ? null : parseFloat(s.lineHeight);
    const words = [];
    for (const m of node.data.matchAll(/\S+/g)) {
      range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
      for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) words.push({ word: m[0], left: r.left, top: r.top, right: r.right, bottom: r.bottom, allow: lineHeight ? Math.max(0, (r.height - lineHeight) / 2) : 0 });
    }
    if (!words.length) continue;
    runs.push({ node, parent, words, fontSize });
  }

  // small-font (on-screen text only, like scripts/test-phone.mjs)
  const smallSeen = new Set();
  for (const run of runs) if (run.fontSize < minFont - 0.01 && run.words.some(w => w.right > 0 && w.bottom > 0 && w.left < vw && w.top < vh) && !smallSeen.has(run.parent)) {
    smallSeen.add(run.parent); add("small-font", run.parent, `${run.fontSize.toFixed(1)}px < ${minFont}px`, { num: { fontSize: run.fontSize } });
  }

  // escape / clipped / ellipsis / offscreen text
  const escapes = new Map(), clipped = new Map(), offText = new Map();
  for (const run of runs) {
    // Nearest boxed ancestor, unless an overflow container comes first (then clipping decides).
    let boxedBy = null;
    for (let a = run.parent; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (boxed(a)) { const r = rect(a); if (!(r.width >= 0.9 * vw && r.height >= 0.9 * vh)) boxedBy = a; break; }
      if (style(a).overflowX !== "visible" || style(a).overflowY !== "visible") break;
    }
    for (const w of run.words) {
      if (boxedBy && !clips(boxedBy, "x") && !clips(boxedBy, "y")) {
        const r = rect(boxedBy);
        const dx = Math.max(r.left - w.left, w.right - r.right), dy = Math.max(r.top - (w.top + w.allow), (w.bottom - w.allow) - r.bottom);
        if (dx > tol || dy > tol) {
          const entry = escapes.get(boxedBy) ?? { words: [], dx: 0, dy: 0, union: null };
          entry.words.push(w.word); entry.dx = Math.max(entry.dx, dx); entry.dy = Math.max(entry.dy, dy);
          entry.union = entry.union ? { left: Math.min(entry.union.left, w.left), top: Math.min(entry.union.top, w.top), right: Math.max(entry.union.right, w.right), bottom: Math.max(entry.union.bottom, w.bottom) } : { left: w.left, top: w.top, right: w.right, bottom: w.bottom };
          escapes.set(boxedBy, entry);
        }
      }
      // Innermost clipping ancestor that cuts this word.
      let scrolled = { x: false, y: false };
      for (let a = run.parent; a && a !== document.documentElement; a = a.parentElement) {
        const p = padBox(a);
        const outX = w.left < p.left - tol || w.right > p.right + tol, outY = (w.top + w.allow) < p.top - tol || (w.bottom - w.allow) > p.bottom + tol;
        if ((outX && scrolls(a, "x")) ) scrolled.x = true;
        if ((outY && scrolls(a, "y"))) scrolled.y = true;
        if ((outX && clips(a, "x") && !scrolled.x) || (outY && clips(a, "y") && !scrolled.y)) {
          if (a === document.body) break;
          const entry = clipped.get(a) ?? { words: [], dx: 0, dy: 0 };
          entry.words.push(w.word);
          entry.dx = Math.max(entry.dx, outX ? Math.max(p.left - w.left, w.right - p.right) : 0);
          entry.dy = Math.max(entry.dy, outY ? Math.max(p.top - w.top - w.allow, w.bottom - w.allow - p.bottom) : 0);
          clipped.set(a, entry); break;
        }
      }
      // Off the viewport with no way to scroll to it.
      const offX = w.left < -tol || w.right > vw + tol, offY = w.top + w.allow < -tol || w.bottom - w.allow > vh + tol;
      if ((offX && !scrollPath(run.parent, "x")) || (offY && !scrollPath(run.parent, "y"))) {
        // Already reported if an ancestor clips it; only text that runs off the edge of the frame counts here.
        const holder = run.parent.closest("p, li, h1, h2, h3, h4, button, a, label, span, strong, b, small, div") ?? run.parent;
        const entry = offText.get(holder) ?? { words: [] }; entry.words.push(w.word); offText.set(holder, entry);
      }
    }
  }
  for (const [el, e] of escapes) add("escape", el, `${e.words.length} word(s) outside the border box by ${e.dx.toFixed(1)}px x / ${e.dy.toFixed(1)}px y: "${e.words.slice(0, 8).join(" ")}"`, { num: { dx: +e.dx.toFixed(1), dy: +e.dy.toFixed(1), words: e.words.length, box: box(rect(el)) }, rect: { left: Math.min(rect(el).left, e.union.left), top: Math.min(rect(el).top, e.union.top), width: Math.max(rect(el).right, e.union.right) - Math.min(rect(el).left, e.union.left), height: Math.max(rect(el).bottom, e.union.bottom) - Math.min(rect(el).top, e.union.top) } });
  for (const [el, e] of clipped) {
    const s = style(el), kind = s.textOverflow === "ellipsis" ? "ellipsis" : s.webkitLineClamp && s.webkitLineClamp !== "none" ? "ellipsis" : "clipped";
    add(kind, el, `${kind === "ellipsis" ? "truncated" : "cut off"} by overflow ${s.overflowX}/${s.overflowY}: ${e.words.length} word(s), ${e.dx.toFixed(1)}px x / ${e.dy.toFixed(1)}px y (scroll ${el.scrollWidth}×${el.scrollHeight} vs client ${el.clientWidth}×${el.clientHeight}); hidden: "${e.words.slice(0, 8).join(" ")}"`, { num: { dx: +e.dx.toFixed(1), dy: +e.dy.toFixed(1), scrollW: el.scrollWidth, clientW: el.clientWidth, scrollH: el.scrollHeight, clientH: el.clientHeight }, full: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300) });
  }
  for (const [el, e] of offText) add("offscreen", el, `text off the ${vw}×${vh} view with no scroll path: "${e.words.slice(0, 8).join(" ")}"`, { num: { words: e.words.length } });

  // ── Controls: overlap, off-screen, tap size ───────────────────────────────
  const controls = [], seen = new Set();
  for (let el of document.querySelectorAll("button, a[href], input, select, textarea, summary, [role=button], [tabindex]:not([tabindex='-1'])")) {
    if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type)) el = el.closest("label") ?? el;
    if (seen.has(el) || el.tagName === "CANVAS" || !visible(el)) continue;
    seen.add(el);
    const r = rect(el);
    if (r.width < 1 || r.height < 1) continue;
    if (r.height < minTap - 0.5 || r.width < minTap - 0.5) add("small-tap", el, `${r.width.toFixed(0)}×${r.height.toFixed(0)} < ${minTap}px`, { num: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) } });
    if (inert(el)) continue;
    const vis = visRect(el);
    if (vis && !backHidden(el)) {
      const cx = Math.min(vw - 1, Math.max(0, (vis.left + vis.right) / 2)), cy = Math.min(vh - 1, Math.max(0, (vis.top + vis.bottom) / 2));
      const top = document.elementFromPoint(cx, cy);
      controls.push({ el, r: vis, hit: Boolean(top && (el.contains(top) || top.contains(el))), g: group(el) });
    }
    const offX = r.left < -tol || r.right > vw + tol, offY = r.top < -tol || r.bottom > vh + tol;
    if (offX || offY) {
      const path = [offX && scrollPath(el, "x"), offY && scrollPath(el, "y")].filter(v => v !== false);
      if (path.some(v => v === null || v === "container-offscreen")) add("offscreen", el, `control at ${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width.toFixed(0)}×${r.height.toFixed(0)} outside the ${vw}×${vh} view, scroll path: ${path.map(v => v ?? "none").join("/")}`, { num: { left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), vw, vh } });
    }
  }
  const shrink = (r, d = 1) => ({ left: r.left + d, top: r.top + d, right: r.right - d, bottom: r.bottom - d });
  const meet = (a, b) => { const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return w > 0 && h > 0 ? { w, h, left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) } : null; };
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = controls[i], b = controls[j];
    if (a.g !== b.g || a.el.contains(b.el) || b.el.contains(a.el) || (!a.hit && !b.hit) || underPin(a.el, b.el)) continue;
    const m = meet(shrink(a.r), shrink(b.r));
    if (!m || m.w * m.h < 4) continue;
    const u = { left: Math.min(a.r.left, b.r.left), top: Math.min(a.r.top, b.r.top), width: Math.max(a.r.right, b.r.right) - Math.min(a.r.left, b.r.left), height: Math.max(a.r.bottom, b.r.bottom) - Math.min(a.r.top, b.r.top) };
    add("overlap", a.el, `control overlaps ${sel(b.el)} "${textOf(b.el).slice(0, 40)}" by ${m.w.toFixed(1)}×${m.h.toFixed(1)}px`, { num: { w: +m.w.toFixed(1), h: +m.h.toFixed(1) }, other: sel(b.el), rect: u });
  }
  for (const el of document.querySelectorAll("*")) {
    if (!(scrolls(el, "x") || scrolls(el, "y")) || !visible(el) || inert(el)) continue;
    const r = rect(el);
    if (r.left < -tol || r.top < -tol || r.right > vw + tol || r.bottom > vh + tol) {
      if (!scrollPath(el, r.left < -tol || r.right > vw + tol ? "x" : "y")) add("offscreen", el, `scroll container ${r.width.toFixed(0)}×${r.height.toFixed(0)} at ${r.left.toFixed(0)},${r.top.toFixed(0)} extends off the ${vw}×${vh} view: its end cannot be scrolled into view`, { num: { bottom: +r.bottom.toFixed(1), right: +r.right.toFixed(1), vw, vh } });
    }
  }

  // ── Text on text (line boxes, per text node) ─────────────────────────────
  const lines = [];
  for (const run of runs) {
    if (inert(run.parent)) continue;
    const byLine = new Map();
    for (const w of run.words) {
      const key = Math.round(w.top);
      const l = byLine.get(key) ?? { left: Infinity, right: -Infinity, top: w.top + w.allow, bottom: w.bottom - w.allow };
      l.left = Math.min(l.left, w.left); l.right = Math.max(l.right, w.right); byLine.set(key, l);
    }
    const vis = visRect(run.parent);
    if (!vis || backHidden(run.parent)) continue;
    for (const line of byLine.values()) {
      const l = { left: Math.max(line.left, vis.left), right: Math.min(line.right, vis.right), top: Math.max(line.top, vis.top), bottom: Math.min(line.bottom, vis.bottom) };
      if (l.right - l.left > 1 && l.bottom - l.top > 1 && inViewport(l)) lines.push({ run, r: l, g: group(run.parent) });
    }
  }
  const pairs = new Set();
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const a = lines[i], b = lines[j];
    if (a.run === b.run || a.g !== b.g || underPin(a.run.parent, b.run.parent)) continue;
    const m = meet(shrink(a.r, 0.5), shrink(b.r, 0.5));
    if (!m || m.w < 2 || m.h < 2 || m.w * m.h < 12) continue;
    const key = `${sel(a.run.parent)}|${sel(b.run.parent)}`; if (pairs.has(key)) continue; pairs.add(key);
    const u = { left: Math.min(a.r.left, b.r.left), top: Math.min(a.r.top, b.r.top), width: Math.max(a.r.right, b.r.right) - Math.min(a.r.left, b.r.left), height: Math.max(a.r.bottom, b.r.bottom) - Math.min(a.r.top, b.r.top) };
    add("overlap-text", a.run.parent, `text "${a.run.node.data.trim().slice(0, 40)}" overlaps text "${b.run.node.data.trim().slice(0, 40)}" of ${sel(b.run.parent)} by ${m.w.toFixed(1)}×${m.h.toFixed(1)}px`, { num: { w: +m.w.toFixed(1), h: +m.h.toFixed(1) }, other: sel(b.run.parent), rect: u });
  }

  // ── Page ─────────────────────────────────────────────────────────────────
  const sw = document.documentElement.scrollWidth;
  if (sw > vw + 1) add("hscroll", document.documentElement, `document is ${sw}px wide in a ${vw}px view`, { num: { scrollWidth: sw, innerWidth: vw } });
  const fonts = [...document.fonts].map(face => `${face.family.replace(/"/g, "")} ${face.weight}:${face.status}`);
  return { findings, vw, vh, fonts: [...new Set(fonts)] };
}

/** Realistic longest values for the text slots the game fills from data (game/nextgoal.ts, engine keeper names,
 *  big balances). Applied in-page for one scan and then restored (text node data only: React keeps its nodes). */
export function applyStress(table) {
  const saved = [];
  const setText = (el, text) => {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    if (!nodes.length) return;
    nodes.forEach((n, i) => { saved.push([n, n.data]); n.data = i === 0 ? text : ""; });
  };
  let applied = 0;
  for (const { selector, text, after } of table) {
    for (const el of document.querySelectorAll(selector)) {
      if (!el.checkVisibility()) continue;
      if (after) { // replace the text that follows a child (e.g. after <b>NEXT GOAL</b>)
        const lead = el.querySelector(after);
        const rest = [...el.childNodes].filter(n => n.nodeType === 3 && lead && (lead.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING));
        rest.forEach((n, i) => { saved.push([n, n.data]); n.data = i === 0 ? text : ""; });
      } else setText(el, text);
      applied++;
    }
  }
  window.__pkOverflowRestore = () => { for (const [n, data] of saved.reverse()) n.data = data; delete window.__pkOverflowRestore; };
  return applied;
}
export function restoreStress() { window.__pkOverflowRestore?.(); }

/** Outline a rect (for the screenshot crop), outside the React root. */
export function markRect(r) {
  const mark = document.createElement("div");
  mark.id = "pk-overflow-mark";
  Object.assign(mark.style, { position: "fixed", left: `${r.x - 2}px`, top: `${r.y - 2}px`, width: `${r.w + 4}px`, height: `${r.h + 4}px`, outline: "2px dashed #ff00ff", pointerEvents: "none", zIndex: 2147483647 });
  document.body.append(mark);
}
export function unmark() { document.getElementById("pk-overflow-mark")?.remove(); }
