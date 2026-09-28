import { test } from "node:test";
import assert from "node:assert/strict";
import { freeKickSetup } from "@penalty-kings/engine";
import { atmosphereParams, renderLayer, compositeLayer, ditherLevel, vignetteParams, BAYER4, ATMOS_LOOKS, type Atmosphere } from "../../games/penalty-kings/gfx/atmosphere.ts";
import { GOAL, PENALTY_GOAL, THEMES, penaltyY, type StadiumId, type Weather } from "../../games/penalty-kings/gfx/stadium.ts";
import { Stage, BACKDROP_DROP } from "../../games/penalty-kings/gfx/stage.ts";
import { goalTransform } from "../../games/penalty-kings/gfx/setpieces.ts";

// Stadium atmosphere (docs/GREATNESS.md deferred list, owner: "crowd band + floodlight pool behind the goal"):
// a darker, lower-contrast crowd band directly behind the goal, a dithered floodlight pool on the grass around
// the goal mouth and a stepped vignette. Pixel art (flat strengths + a 4×4 ordered dither), pre-rendered, static.

const STADIUMS: StadiumId[] = ["park", "pro", "champions"];
const WEATHERS: Weather[] = ["sun", "rain", "snow", "fog", "sunset"];
const GRASS_TOP = BACKDROP_DROP + 102;
const W = 480, H = 320;

function stubDocument() {
  if ((globalThis as { document?: unknown }).document) return;
  const context: unknown = new Proxy({}, { get: (_t, key) => (key === "canvas" ? {} : key === "measureText" ? () => ({ width: 0 }) : key === "createImageData" ? () => ({ data: new Uint8ClampedArray(0) }) : () => context), set: () => true });
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
}

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const lum = (r: number, g: number, b: number) => { const f = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** A synthetic penalty-view frame: a busy crowd (every pixel a random fan colour or seat), boards, striped grass. */
function frame(stadium: StadiumId) {
  const theme = THEMES[stadium], data = new Uint8ClampedArray(W * H * 4);
  const fans = ["#e63946", "#ffd23f", "#2a6fdb", "#ffffff", "#43a047", "#ff8fab", "#7fd3ff", "#111111", "#e0ac69", theme.stands, theme.standLine].map(hex);
  let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y < BACKDROP_DROP ? hex(theme.sky[0]) : y < GRASS_TOP - 12 ? fans[Math.floor(rnd() * fans.length)] : y < GRASS_TOP ? hex(theme.boards[Math.floor(x / 160) % theme.boards.length]) : hex(theme.grass[Math.floor((y - GRASS_TOP) / 9) % 2]);
    data.set([...c, 255], (y * W + x) * 4);
  }
  return data;
}
function apply(data: Uint8ClampedArray, atmos: Atmosphere) {
  const out = data.slice();
  compositeLayer(out, W, H, atmos.band, renderLayer(atmos.band));
  compositeLayer(out, W, H, atmos.pool, renderLayer(atmos.pool));
  return out;
}
function stats(data: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number) {
  const values: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; values.push(lum(data[i], data[i + 1], data[i + 2])); }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { mean, sd: Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length) };
}
const penalty = (stadium: StadiumId, weather: Weather = "sun") => atmosphereParams(stadium, weather, PENALTY_GOAL, GRASS_TOP);
const goalBox = () => { const hw = GOAL.unit * PENALTY_GOAL.g, gh = (GOAL.line - GOAL.bar) * PENALTY_GOAL.g; return { left: Math.round(PENALTY_GOAL.x - hw), right: Math.round(PENALTY_GOAL.x + hw), bar: Math.round(PENALTY_GOAL.y - gh), line: Math.round(PENALTY_GOAL.y) }; };

test("atmosphere: per-stadium parameters — pool centred on the goal mouth, band behind the goal, integer px, 2–4 dither steps", () => {
  const box = goalBox();
  for (const stadium of STADIUMS) for (const weather of WEATHERS) {
    const { band, pool } = penalty(stadium, weather);
    for (const layer of [band, pool]) {
      for (const key of ["x", "y", "w", "h"] as const) assert.ok(Number.isInteger(layer[key]), `${stadium}/${weather} ${layer.kind}.${key} is whole px`);
      assert.ok(layer.steps >= 2 && layer.steps <= 4, "2–4 dither steps");
      assert.ok(layer.alpha > 0 && layer.alpha <= 0.45, `${layer.kind} is gentle (${layer.alpha})`);
    }
    // Pool: centred on the goal mouth, in front of the line (between the goal line and the spot), never above the grass.
    assert.equal(pool.cx, Math.round(PENALTY_GOAL.x));
    assert.ok(pool.cy >= box.line && pool.cy < penaltyY(5.5) + 6, `pool centre y ${pool.cy} at the goal mouth / six-yard box`);
    assert.ok(pool.rx > (box.right - box.left) / 2, "the pool spreads beyond the posts");
    assert.ok(pool.y >= GRASS_TOP, "the pool is on the grass");
    // Band: covers the goal (posts ± a margin), from above the bar down to the grass, and stops there.
    assert.ok(band.coreLeft <= box.left && band.coreRight >= box.right, "full strength across the whole goal");
    assert.ok(band.coreTop <= box.bar && band.y <= band.coreTop, "and above the crossbar");
    assert.ok(band.y >= BACKDROP_DROP + ATMOS_LOOKS[stadium].standTop, "never past the top of the stands (the Park's sky stays clear)");
    if (stadium !== "park") assert.ok(band.y < band.coreTop, "fading upward into the upper tiers");
    assert.equal(band.y + band.h, GRASS_TOP, "the band ends where the grass begins");
    assert.ok(band.x > 0 && band.x + band.w < W, "a band behind the goal, not the whole stand");
  }
  // Each ground has its own light: golden at Champions, cool at Pro, a soft sun at the Park (weaker than the night bowls).
  const [park, pro, champions] = STADIUMS.map(id => penalty(id).pool);
  assert.ok(champions.tone[0] > champions.tone[2] + 60, "Champions' pool is golden");
  assert.ok(pro.tone[2] >= pro.tone[0], "Pro's pool is a cool white");
  assert.ok(park.alpha < pro.alpha && park.alpha < champions.alpha, "daylight Park gets the gentlest pool");
  assert.ok(penalty("pro", "rain").pool.alpha > pro.alpha, "rain: a wetter, brighter pool");
  assert.ok(penalty("pro", "fog").pool.alpha < pro.alpha && penalty("pro", "fog").pool.rx > pro.rx, "fog: weaker and wider");
});

test("atmosphere: dithered in flat strengths — every pixel is one of steps + 1 alphas, joined by a 4×4 Bayer pattern", () => {
  assert.equal(new Set(BAYER4.flat()).size, 16);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { assert.equal(ditherLevel(0, 3, x, y), 0); assert.equal(ditherLevel(1, 3, x, y), 3); assert.equal(ditherLevel(2 / 3, 3, x, y), 2); }
  // Half-way between two strengths: exactly half the pixels of a 4×4 tile step up.
  let up = 0; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) up += ditherLevel(0.5 / 3, 3, x, y); assert.equal(up, 8);
  for (const stadium of STADIUMS) {
    const { band, pool } = penalty(stadium), vignette = vignetteParams([0, 4, 20], 0.38);
    for (const layer of [band, pool, vignette]) {
      const px = renderLayer(layer), alphas = new Set<number>();
      for (let i = 3; i < px.length; i += 4) alphas.add(px[i]);
      assert.ok(alphas.size <= layer.steps + 1, `${layer.kind}: ${alphas.size} alphas (no smooth gradient)`);
      assert.ok(alphas.size >= 3, `${layer.kind}: at least two visible strengths`);
    }
  }
});

test("atmosphere: static lighting — no time input, identical under reduced motion, placed by the goal in both views", () => {
  stubDocument();
  for (const stadium of STADIUMS) {
    const stage = new Stage({ stadium, weather: "rain" }), a = stage.atmosphere();
    assert.equal(a.animated, false);
    for (let i = 0; i < 30; i++) stage.update(1 / 60);
    stage.setReduced(true);
    assert.deepEqual(stage.atmosphere(), a, "the same layers over time and under reduced motion");
    assert.deepEqual(a, atmosphereParams(stadium, "rain", PENALTY_GOAL, GRASS_TOP));
  }
  // Free kicks: the goal is smaller and higher; the layers follow it (the band stops at the free-kick view's grass, y 102).
  const setup = freeKickSetup(3, { distance: 24 }), xf = goalTransform(setup), fk = atmosphereParams("pro", "sun", xf, 102);
  assert.equal(fk.pool.cx, Math.round(xf.x)); assert.equal(fk.band.y + fk.band.h, 102);
  assert.ok(fk.pool.rx < penalty("pro").pool.rx, "a farther goal gets a smaller pool");
});

test("atmosphere: the crowd band behind the goal is darker and lower-contrast than the band elsewhere", () => {
  const box = goalBox();
  for (const stadium of STADIUMS) {
    const before = frame(stadium), after = apply(before, penalty(stadium));
    const behind = [box.left + 4, box.bar, box.right - 4, GRASS_TOP] as const, elsewhere = [8, box.bar, 108, GRASS_TOP] as const;
    const b = stats(after, ...behind), e = stats(after, ...elsewhere), b0 = stats(before, ...behind);
    assert.ok(b.mean <= e.mean * 0.8, `${stadium}: behind the goal ${b.mean.toFixed(3)} is ≥ 20% darker than elsewhere ${e.mean.toFixed(3)}`);
    assert.ok(b.sd <= b0.sd * 0.8, `${stadium}: lower contrast behind the goal (sd ${b0.sd.toFixed(3)} → ${b.sd.toFixed(3)})`);
    assert.deepEqual(stats(after, ...elsewhere), stats(before, ...elsewhere), `${stadium}: the rest of the stand is untouched`);
  }
});

test("atmosphere: the goal mouth pops — net / keeper / ball contrast against it rises, the pool lifts the grass", () => {
  const box = goalBox(), white = lum(255, 255, 255), netGrey = lum(0xe8, 0xe8, 0xe8);
  for (const stadium of STADIUMS) {
    const before = frame(stadium), atmos = penalty(stadium), after = apply(before, atmos);
    const behind = [box.left + 4, box.bar, box.right - 4, GRASS_TOP] as const;
    const b0 = stats(before, ...behind).mean, b1 = stats(after, ...behind).mean;
    assert.ok(ratio(netGrey, b1) > ratio(netGrey, b0) * 1.1, `${stadium}: net vs the crowd behind it ${ratio(netGrey, b0).toFixed(2)} → ${ratio(netGrey, b1).toFixed(2)}`);
    // Goal mouth (grass between the posts, line to six-yard line) vs the grass beside it at the same depth.
    const six = Math.round(penaltyY(5.5)), mouth = [box.left, box.line, box.right, six] as const, side = [0, box.line, box.left - 60, six] as const;
    const m0 = stats(before, ...mouth).mean, m1 = stats(after, ...mouth).mean, s1 = stats(after, ...side).mean;
    assert.ok(m1 >= m0 * 1.05, `${stadium}: the pool lifts the goal mouth (${m0.toFixed(3)} → ${m1.toFixed(3)})`);
    assert.ok(m1 / s1 > m0 / stats(before, ...side).mean, `${stadium}: the goal mouth stands out from the grass beside it`);
    // B7 holds: the white ball still reads against the brightest pool grass (and keeps its dark outline).
    let brightest = 0;
    for (let y = atmos.pool.y; y < atmos.pool.y + atmos.pool.h; y++) for (let x = atmos.pool.x; x < atmos.pool.x + atmos.pool.w; x++) { const i = (y * W + x) * 4; brightest = Math.max(brightest, lum(after[i], after[i + 1], after[i + 2])); }
    assert.ok(ratio(white, brightest) >= 2.5, `${stadium}: ball vs lit grass ${ratio(white, brightest).toFixed(2)}`);
  }
});
