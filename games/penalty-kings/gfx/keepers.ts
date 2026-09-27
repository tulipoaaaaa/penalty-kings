/**
 * Twelve original keepers (round 6 E23: higher-fidelity frames and secondary motion).
 *
 * Each keeper is authored as palette-indexed pixel rows: a standing `body`, a full-length `dive`
 * stretch, and small animated `parts` (tails, crests, tentacles, scarf, tassels, leaf, antenna,
 * sheet hem) stamped onto them. keeperRows() composes every frame from those pieces:
 *
 *   idle · breathe · blink         standing loop (breath, blinks, parts sway)       display only
 *   set · launch · stretch         ready crouch, tucked take-off, full stretch       PHYSICS POSES
 *   land                           after the crossing: squashed onto the grass       display only
 *   cheer · taunt · sad            celebration, archetype taunt, slump               display only
 *
 * PHYSICS = RENDER: the three physics poses are the only bodies drawn while a penalty is in flight.
 * Their parts are frozen (one frame each), so their opaque pixels never depend on the clock, and
 * scripts/gen-keeper-masks.mjs copies those pixels into the engine's KEEPER_RIGS masks
 * (tests/game/keeper-sync.test.ts proves art = masks and render = physics). Animation that runs
 * during a flight only recolours opaque pixels (palette cycles, visor scan, disco sequins), or is a
 * translucent effect that never looks solid. Display frames get a transparent margin (PAD) so
 * fans, tails and tentacles can reach past the physics grid when no ball is in play.
 *
 * Palette keys: '1' outline · '2' main · '3' secondary · '4' highlight · '5' white · '6' dark
 * detail · '7' accent · '8' shade · '9' extra.
 */
import { ART_UNIT, GOAL_ASPECT, LEG_RADIUS, type KeeperId, type KeeperFrame, type RigPose } from "@penalty-kings/engine";
import { sprite, pixelStar, type Palette } from "./core.js";

export type KeeperLook = RigPose | "idle" | "breathe" | "blink" | "land" | "cheer" | "taunt" | "sad";
const PHYSICS_LOOKS: readonly KeeperLook[] = ["set", "launch", "stretch"];
const DIVE_LOOKS: readonly KeeperLook[] = ["launch", "stretch", "land"];
/** Transparent margin (sprite px) around display frames: left, right and top. Physics poses have none. */
export const PAD = 5;

type Cell = readonly [number, number];
type Part = {
  /** Animation frames (idle / cheer cycle through them). */
  frames: string[][];
  /** Top-left cell on the standing body and on the dive body (null: not drawn on that body). */
  body: Cell | null; dive: Cell | null;
  /** Frames used on the dive body (launch = first, stretch = last). Defaults to `frames`. */
  diveFrames?: string[][];
  /** The frozen frame on the set pose. */
  still?: number;
  /** Fill only transparent pixels (tails and fans go behind the body). */
  behind?: boolean;
  /** Add a '1' outline around the part's pixels. */
  outline?: boolean;
  /** Never on a physics pose (the part only exists when no ball is in flight). */
  displayOnly?: boolean;
};
type Face = { eyes: Cell[]; tall: boolean; mouth: Cell[]; skin: string };
type Design = {
  body: string[]; dive: string[]; palette: Palette; arm: string; glove: string;
  scale: number; shoulderY: number; armLength: number;
  sfx: "squeak" | "chitter" | "yawn" | "honk" | "blub" | "mime" | "disco" | "stomp" | "hiss" | "beep" | "boo" | "rumble";
  /** Rows removed to make the set crouch, the exhale, and the dive tuck (null: that keeper keeps its shape). */
  crouch: number | null; chest: number | null; tuck: number | null;
  face: Face; diveFace?: Face;
  parts: Part[];
  /** Palette keys whose colour cycles over time (lights, glows): silhouette-safe by construction. */
  cycles?: { key: string; colors: string[]; rate: number }[];
  /** Pixel recolours by phase inside the silhouette (visor scan, sequins): opaque → opaque only. */
  shimmer?: (ch: string, c: number, r: number, phase: number) => string;
  /** Peacock: the display-only tail fan, generated and leaned towards the tell. */
  fan?: boolean;
};

const pad = (rows: string[]) => { const w = Math.max(...rows.map(r => r.length)); return rows.map(r => r.padEnd(w, ".")); };
/** Sway a part: row i shifts by round(amp · (1 − i / (h − 1))) (top moves most), in a 1-px wider box. */
function sway(rows: string[], amps: number[], from: "top" | "bottom" = "top") {
  const h = rows.length, w = rows[0].length + 2;
  return amps.map(amp => rows.map((row, i) => {
    const k = from === "top" ? 1 - i / Math.max(1, h - 1) : i / Math.max(1, h - 1), shift = Math.round(amp * k);
    return (".".repeat(1 + shift) + row + "..").slice(0, w);
  }));
}

/** THE FINAL WALL's silhouette (unchanged since round 6 B4: the Skill Cup referee's boss hitbox). */
const WALL = pad([
  "...1.1.1.1.1....",
  "...1757175711...",
  "..11111111111...",
  ".1233323332321..",
  ".1466614666441..",
  ".1233329332321..",
  ".1444144414441..",
  "1233233323332311",
  "1444144414441411",
  "1233233323392311",
  "1444144414441411",
  ".1233323332321..",
  ".12331...12331..",
  ".11111...11111..",
]);

const DESIGNS: Readonly<Record<KeeperId, Design>> = {
  // Squeak: tiny, huge round ears, whiskers, a jersey too big for him and a curly pink tail.
  mouse: {
    scale: 2.2, shoulderY: 9, armLength: 6, arm: "#9aa3ad", glove: "#ff8fab", sfx: "squeak", crouch: 13, chest: 11, tuck: 13,
    palette: { "1": "#2b2d42", "2": "#9aa3ad", "3": "#ff8fab", "4": "#d7dde5", "5": "#ffffff", "6": "#111111", "7": "#2a6fdb", "8": "#6f7883", "9": "#1b2340" },
    body: pad([
      "..111......111..",
      ".13331....13331.",
      ".13331111113331.",
      ".13312222221331.",
      "..112222222211..",
      "...1226226221...",
      "...1226226221...",
      ".66124233242166.",
      "...1182222811...",
      "....17777771....",
      "...1777777771...",
      "...1777557771...",
      "...1777557771...",
      "....19999991....",
      "....121..121....",
      "...1331..1331...",
    ]),
    dive: pad([
      ".111........111.",
      "13331......13331",
      "13331111111 3331".replace(" ", "1"),
      ".1312222222 131.".replace(" ", "2"),
      "..122222222221..",
      "...1266226621...",
      "...1266226621...",
      ".66124233242166.",
      "...1182222811...",
      "....17777771....",
      "....17755771....",
      "....17755771....",
      ".....199991.....",
      ".....122221.....",
      "......1221......",
      "......1331......",
    ]),
    face: { eyes: [[6, 5], [9, 5]], tall: true, mouth: [[7, 8], [8, 8]], skin: "2" },
    parts: [{
      behind: true, body: [11, 9], dive: [10, 11], still: 0,
      frames: sway([
        "..33",
        ".3..",
        ".3..",
        "3...",
        "3...",
      ], [0, 1, 2, 1], "top"),
      diveFrames: [["..3", ".3.", ".3.", "3.."], ["...3", "..3.", ".3..", "3..."]],
    }],
  },
  // Nibbles: twitchy, pointed ear tufts, buck teeth and a huge S-shaped bushy tail.
  squirrel: {
    scale: 2.8, shoulderY: 8, armLength: 7, arm: "#e07a2e", glove: "#ffd23f", sfx: "chitter", crouch: 12, chest: 10, tuck: 12,
    palette: { "1": "#3b1f0f", "2": "#e07a2e", "3": "#f6c28b", "4": "#ffb066", "5": "#ffffff", "6": "#111111", "8": "#b35a1a" },
    body: pad([
      "...11......11....",
      "..1221....1221...",
      "..1222111122221..",
      "...12222222221...",
      "...12562226521...",
      "...12662226621...",
      "...12233633221...",
      "....122353221....",
      "...12222222221...",
      "..1223333333221..",
      "..1223344433221..",
      "..1223333333221..",
      "...12233333221...",
      "...1221...1221...",
      "..11111...11111..",
    ]),
    dive: pad([
      "..11........11...",
      "..1221....1221...",
      "..1222111122221..",
      "...12222222221...",
      "...12662226621...",
      "...12662226621...",
      "...12233633221...",
      "....122353221....",
      "....122222221....",
      "...12233333221...",
      "...12334443321...",
      "....123333321....",
      "....122222221....",
      ".....1221221.....",
      ".....1111111.....",
    ]),
    face: { eyes: [[6, 4], [10, 4]], tall: true, mouth: [[7, 7], [9, 7]], skin: "2" },
    parts: [{
      behind: true, outline: true, body: [11, 0], dive: [11, 5], still: 1,
      frames: sway([
        ".2222",
        "22442",
        "2...2",
        "....2",
        "...22",
        "..224",
        ".2242",
        ".2422",
        "22422",
        "2242.",
        "242..",
        "22...",
      ], [-1, 0, 1, 0], "top"),
      diveFrames: [[
        "..22",
        ".242",
        "2242",
        "2422",
        "2422",
        "242.",
        "22..",
        "2...",
      ], [
        "..2",
        ".24",
        ".24",
        "242",
        "242",
        "24.",
        "22.",
        "2..",
      ]],
    }],
  },
  // Snooze: shaggy and wide, dark eye stripes, sleepy lids, very long arms, a leaf he forgot about.
  sloth: {
    scale: 3, shoulderY: 8, armLength: 11, arm: "#8b6b4a", glove: "#c9ecff", sfx: "yawn", crouch: 12, chest: 10, tuck: 12,
    palette: { "1": "#2e1f12", "2": "#8b6b4a", "3": "#d9c3a0", "4": "#a98560", "5": "#ffffff", "6": "#111111", "7": "#4caf50", "8": "#5e4630", "9": "#2e7d32" },
    body: pad([
      "...1.111111.1...",
      "...1224224221...",
      "..122333333221..",
      "..123883388321..",
      "..123868868321..",
      "..123336633321..",
      "...1233113321...",
      "...1222222221...",
      "..142222222241..",
      "..122433334221..",
      "..122333333221..",
      "..122433334221..",
      "...1222222221...",
      "...1221..1221...",
      "..11111..11111..",
    ]),
    dive: pad([
      "...1.111111.1...",
      "...1224224221...",
      "..122333333221..",
      "..123883388321..",
      "..123858858321..",
      "..123866866321..",
      "...1233663321...",
      "...1222222221...",
      "..142222222241..",
      "..122433334221..",
      "..122333333221..",
      "...1243334221...",
      "....12222221....",
      "....12211221....",
      "....11111111....",
    ]),
    face: { eyes: [[6, 4], [9, 4]], tall: false, mouth: [[7, 6], [8, 6]], skin: "8" },
    parts: [{
      body: [10, 0], dive: [10, 0], still: 0,
      frames: sway([
        "..97",
        ".977",
        "97..",
      ], [0, 1, 0, -1], "top"),
    }],
  },
  // Pete: long neck, beak, bobbing crest and (off the ball) a full eye-spotted fan that leans with his fake.
  peacock: {
    scale: 2.8, shoulderY: 8, armLength: 7, arm: "#1d8a8a", glove: "#ffd23f", sfx: "honk", crouch: 13, chest: 10, tuck: 13, fan: true,
    palette: { "1": "#0b2b3a", "2": "#1d8a8a", "3": "#2a6fdb", "4": "#7fd3ff", "5": "#ffffff", "6": "#111111", "7": "#ffd23f", "8": "#136363", "9": "#39c0a0" },
    body: pad([
      "................",
      "................",
      "......1111......",
      ".....122221.....",
      "....15622651....",
      ".....127721.....",
      "......1771......",
      "......1331......",
      "...1223333221...",
      "..122333333221..",
      "..122344443221..",
      "..122344443221..",
      "...1233333321...",
      "......7..7......",
      "......7..7......",
      ".....771.177....",
    ]),
    dive: pad([
      "................",
      "......1111......",
      ".....122221.....",
      "....15622651....",
      ".....127721.....",
      "......1771......",
      "......1331......",
      "....12333321....",
      "...1223333221...",
      "...1234444321...",
      "...1234444321...",
      "....12333321....",
      ".....122221.....",
      "......7117......",
      "......7117......",
      "......7117......",
    ]),
    face: { eyes: [[6, 4], [9, 4]], tall: false, mouth: [[7, 6], [8, 6]], skin: "2" },
    parts: [{
      body: [5, 0], dive: [5, 0], still: 1,
      frames: sway([
        "7.7.7",
        "1.1.1",
      ], [-1, 0, 1, 0], "top"),
      diveFrames: [["..7.7.7", "..1.1.1"], [".7.7.7.", "..111.."]],
    }, {
      // Tail feathers trailing between the legs on the dive.
      body: null, dive: [4, 12], behind: true, outline: true,
      frames: [["2..2", "2..2"]],
      diveFrames: [[".2..2", "2...2", "2...2"], ["2....2", "2....2", "9....9", "9....9"]],
    }],
  },
  // Octavia: big spotted dome, wide eyes, and a skirt of tentacles that never stops moving.
  octopus: {
    scale: 2.8, shoulderY: 9, armLength: 9, arm: "#7b3fa0", glove: "#ff9ad5", sfx: "blub", crouch: 9, chest: 7, tuck: 9,
    palette: { "1": "#2a0f3a", "2": "#7b3fa0", "3": "#ff9ad5", "4": "#a86cd0", "5": "#ffffff", "6": "#111111", "8": "#5a2a7a" },
    body: pad([
      ".....111111.....",
      "....12224221....",
      "...1224442421...",
      "..122444444221..",
      "..125662256621..",
      "..126662266621..",
      "..122222222221..",
      "...1223333221...",
      "....12222221....",
      "...1222222221...",
      "..122222222221..",
      "................",
      "................",
      "................",
      "................",
    ]),
    dive: pad([
      ".....111111.....",
      "....12224221....",
      "...1224442421...",
      "..122444444221..",
      "..125662256621..",
      "..126662266621..",
      "..122222222221..",
      "...1223333221...",
      "....12222221....",
      "....12222221....",
      "...1222222221...",
      "................",
      "................",
      "................",
      "................",
    ]),
    face: { eyes: [[5, 4], [10, 4]], tall: true, mouth: [[7, 7], [8, 7]], skin: "2" },
    parts: [{
      body: [1, 10], dive: [2, 10], still: 0,
      frames: [0, 1, 2, 3].map(k => tentacles(12, [0, 3, 6, 9], 4, k)),
      diveFrames: [tentacles(10, [1, 4, 7], 4, 1, 0.6), tentacles(10, [1, 4, 7], 4, 3, 0.3)],
    }],
  },
  // Marcel: tilted beret, painted face, breton stripes and a red scarf that flutters.
  mime: {
    scale: 2.8, shoulderY: 8, armLength: 7, arm: "#f7f7f2", glove: "#ffffff", sfx: "mime", crouch: 13, chest: 10, tuck: 12,
    palette: { "1": "#111111", "2": "#f7f7f2", "3": "#2a2a3a", "4": "#ff5a6e", "5": "#ffffff", "6": "#111111", "7": "#1e1e2a", "8": "#c93a4c" },
    body: pad([
      ".......1........",
      "....17777771....",
      "...17777777771..",
      "....12222221....",
      "....12622621....",
      "....12622621....",
      "....12244221....",
      ".....122221.....",
      "....14444441....",
      "...1333333331...",
      "...1555555551...",
      "...1333333331...",
      "....15555551....",
      "....1331.1331...",
      "...1111..1111...",
    ]),
    dive: pad([
      ".......1........",
      "....17777771....",
      "...17777777771..",
      "....12222221....",
      "....16222261....",
      "....12622621....",
      "....12266221....",
      ".....122221.....",
      "....14444441....",
      "....13333331....",
      "....15555551....",
      "....13333331....",
      ".....155551.....",
      ".....133331.....",
      ".....111111.....",
    ]),
    face: { eyes: [[6, 4], [9, 4]], tall: true, mouth: [[7, 6], [8, 6]], skin: "2" },
    parts: [{
      body: [10, 8], dive: [10, 8], still: 0, outline: true,
      frames: sway([
        "44..",
        ".48.",
        "..44",
        "...4",
      ], [0, 1, 0, -1], "bottom"),
      diveFrames: [["44..", ".44.", "..4."], ["44...", ".444.", "...44"]],
    }],
  },
  // Dee: towering afro, shades, wide collar, gold medallion, sequins that catch the lights, flares.
  disco: {
    scale: 2.8, shoulderY: 9, armLength: 7, arm: "#c47a3e", glove: "#ccff00", sfx: "disco", crouch: 12, chest: 10, tuck: 12,
    palette: { "1": "#1a0f2e", "2": "#c47a3e", "3": "#ff4fd8", "4": "#6b2fbf", "5": "#ffffff", "6": "#111111", "7": "#ffd23f", "8": "#f2f2ff", "9": "#8f4fe0" },
    body: pad([
      "...111.11.111...",
      "..144414414441..",
      ".14449444494441.",
      "1444444944444441",
      ".14412222221441.",
      "..112566666211..",
      "...1266226621...",
      "...1222552221...",
      "..133312213331..",
      "...1332772331...",
      "...1333773331...",
      "...1777777771...",
      "..188881188881..",
      ".18888811888881.",
      ".111111..111111.",
    ]),
    dive: pad([
      "...111.11.111...",
      "..144414414441..",
      ".14449444494441.",
      "1444444944444441",
      ".14412222221441.",
      "..112566666211..",
      "...1266226621...",
      "...1225555221...",
      "..133312213331..",
      "...1332772331...",
      "...1333773331...",
      "....17777771....",
      "....18888881....",
      "...1888118881...",
      "...1111..1111...",
    ]),
    face: { eyes: [[5, 6], [10, 6]], tall: false, mouth: [[7, 7], [8, 7]], skin: "2" },
    parts: [],
    cycles: [{ key: "3", colors: ["#ff4fd8", "#ccff00", "#7fd3ff", "#ff9d3f"], rate: 4 }, { key: "7", colors: ["#ffd23f", "#ffffff"], rate: 6 }],
    shimmer: (ch, c, r, phase) => (ch === "3" && (c * 3 + r * 5 + phase) % 7 === 0 ? "5" : ch),
  },
  // Bento: topknot, hair band, the widest body in the league, mawashi with swinging sagari.
  sumo: {
    scale: 3.2, shoulderY: 7, armLength: 7, arm: "#f2c79a", glove: "#ffd23f", sfx: "stomp", crouch: 11, chest: 8, tuck: 11,
    palette: { "1": "#3a1f0a", "2": "#f2c79a", "3": "#1d1d6b", "4": "#ffdcb8", "5": "#ffffff", "6": "#111111", "7": "#111111", "8": "#3a3aa0", "9": "#d9a877" },
    body: pad([
      "......1771......",
      ".....117711.....",
      "....17777771....",
      "...1262222621...",
      "...1224114221...",
      "..122222222221..",
      ".12222222222221.",
      "1222244444422221",
      "1222444444442221",
      "1922244444422291",
      "1333333333333331",
      "1333338888333331",
      ".1222......2221.",
      ".1111......1111.",
    ]),
    dive: pad([
      "......1771......",
      ".....117711.....",
      "....17777771....",
      "...1262222621...",
      "...1224664221...",
      "..122222222221..",
      ".12222222222221.",
      "1222244444422221",
      "1222444444442221",
      "1922244444422291",
      "1333333333333331",
      ".13333888833331.",
      "..12221..12221..",
      "..11111..11111..",
    ]),
    face: { eyes: [[5, 3], [10, 3]], tall: false, mouth: [[7, 4], [8, 4]], skin: "2" },
    parts: [{
      body: [5, 12], dive: [6, 12], still: 0,
      frames: sway(["1.1.1", "3.3.3"], [0, 1, 0, -1], "bottom"),
      diveFrames: [["1.1.", "3.3."], ["1.1.", "3.3."]],
    }],
  },
  // Chroma: casque head, a big turret eye that swivels, lime lip line and a spiral tail.
  chameleon: {
    scale: 2.8, shoulderY: 8, armLength: 7, arm: "#3fae4a", glove: "#ffd23f", sfx: "hiss", crouch: 11, chest: 9, tuck: 11,
    palette: { "1": "#0f3a14", "2": "#3fae4a", "3": "#b8f06a", "4": "#2a7d33", "5": "#ffffff", "6": "#111111", "7": "#ff8fab" },
    body: pad([
      "...11111........",
      "..1244421.......",
      "..12222211111...",
      ".1255522222221..",
      ".12566522222221.",
      ".12555222333331.",
      "..122222222221..",
      "...1223333221...",
      "...1222222221...",
      "...1243434321...",
      "...1222222221...",
      "...1243434321...",
      "....1221.1221...",
      "...1111..1111...",
    ]),
    dive: pad([
      "...11111........",
      "..1244421.......",
      "..12222211111...",
      ".1255522222221..",
      ".12556522222221.",
      ".12555222333331.",
      "..122222222221..",
      "...1223333221...",
      "...1222222221...",
      "...1243434321...",
      "....12222221....",
      "....12434321....",
      ".....122221.....",
      ".....111111.....",
    ]),
    face: { eyes: [[4, 4]], tall: false, mouth: [[10, 5], [11, 5]], skin: "5" },
    parts: [{
      behind: true, outline: true, body: [11, 5], dive: [11, 7], still: 0,
      frames: [[
        ".222",
        "2..2",
        "2.22",
        "2...",
        "22..",
        ".22.",
      ], [
        "..22",
        ".2.2",
        ".222",
        "2...",
        "22..",
        ".22.",
      ], [
        ".22.",
        "2..2",
        "2.2.",
        "2...",
        "2...",
        "22..",
      ]],
      diveFrames: [["..22", ".2.2", "2..2", "2.2.", "2..."], ["...2", "...2", "..2.", ".2..", "2..."]],
    }],
    cycles: [{ key: "2", colors: ["#3fae4a", "#46b84f", "#3fae4a", "#38a043"], rate: 2 }],
  },
  // K-33P: boxy head with a scanning visor, bolt shoulders, chest lights, piston legs, springy antenna.
  robot: {
    scale: 2.8, shoulderY: 8, armLength: 7, arm: "#8a96a8", glove: "#ff5a6e", sfx: "beep", crouch: 12, chest: 10, tuck: 12,
    palette: { "1": "#1b1f2e", "2": "#8a96a8", "3": "#d7dde5", "4": "#5a6475", "5": "#ffffff", "6": "#ff5a6e", "7": "#ccff00", "8": "#a12a3a", "9": "#ffd23f" },
    body: pad([
      "................",
      "................",
      "...1111111111...",
      "..133333333331..",
      "..138888888831..",
      "..133333333331..",
      "...1111111111...",
      ".....122221.....",
      ".11122222222111.",
      ".1912777422791..",
      "...1244444421...",
      "...1222222221...",
      "....122..221....",
      "....144..441....",
      "...1111..1111...",
    ]),
    dive: pad([
      "................",
      "................",
      "...1111111111...",
      "..133333333331..",
      "..138888888831..",
      "..133333333331..",
      "...1111111111...",
      ".....122221.....",
      ".11122222222111.",
      ".1912777422791..",
      "...1244444421...",
      "....12222221....",
      ".....122221.....",
      ".....144441.....",
      ".....111111.....",
    ]),
    face: { eyes: [], tall: false, mouth: [], skin: "3" },
    parts: [{
      body: [6, 0], dive: [6, 0], still: 1,
      frames: sway([".7.", ".1."], [-1, 0, 1, 0], "top"),
      diveFrames: [["..7", ".1."], ["7..", ".1."]],
    }],
    cycles: [{ key: "7", colors: ["#ccff00", "#ccff00", "#4a5a00", "#ccff00"], rate: 3 }],
    shimmer: (ch, c, r, phase) => (r === 4 && ch === "8" && Math.abs(c - (3 + ((phase * 2) % 16 < 8 ? (phase * 2) % 8 : 7 - ((phase * 2) % 8)) * 1.25)) < 1 ? "6" : ch),
  },
  // Boo: a tall rounded sheet with hollow eyes, an "o" mouth and a hem that ripples.
  ghost: {
    scale: 2.8, shoulderY: 8, armLength: 6, arm: "#cfd8e3", glove: "#e8f4ff", sfx: "boo", crouch: null, chest: 9, tuck: 10,
    palette: { "1": "#6a7a90", "2": "#e8f4ff", "3": "#cfd8e3", "4": "#ffffff", "5": "#ffffff", "6": "#1a1f2b" },
    body: pad([
      ".....111111.....",
      "....12242221....",
      "...1224222221...",
      "..122662266221..",
      "..122662266221..",
      "..122222222221..",
      "..122226622221..",
      "..122226622221..",
      "..122222222221..",
      "..132222222231..",
      "..133222222331..",
      "..133322223331..",
      "................",
      "................",
    ]),
    dive: pad([
      ".....111111.....",
      "....12242221....",
      "...1224222221...",
      "..122662266221..",
      "..122662266221..",
      "..122222222221..",
      "..122226622221..",
      "..122226622221..",
      "..122222222221..",
      "..132222222231..",
      "...1322222231...",
      "...1332222331...",
      "................",
      "................",
    ]),
    face: { eyes: [[5, 3], [6, 3], [9, 3], [10, 3]], tall: true, mouth: [[7, 6], [8, 6]], skin: "2" },
    parts: [{
      body: [2, 12], dive: [3, 12], still: 0,
      frames: [0, 1, 2].map(k => hem(12, k)),
      diveFrames: [hem(10, 1), hem(10, 2)],
    }],
  },
  // THE FINAL WALL: a brick golem with a crown and furnace eyes. Rigid: every pose keeps the same
  // silhouette (the Skill Cup referee's hitbox never changes); only the glow and the crown move.
  finalwall: {
    scale: 3.4, shoulderY: 7, armLength: 9, arm: "#8d4a3a", glove: "#ffd23f", sfx: "rumble", crouch: null, chest: null, tuck: null,
    palette: { "1": "#1a0a06", "2": "#8d4a3a", "3": "#b0664f", "4": "#5e2f25", "5": "#ffd23f", "6": "#ff3b1f", "7": "#ffd23f", "8": "#ffe9a8", "9": "#c9563c" },
    body: WALL, dive: WALL,
    face: { eyes: [[3, 4], [4, 4], [5, 4], [8, 4], [9, 4], [10, 4]], tall: false, mouth: [], skin: "4" },
    parts: [],
    cycles: [{ key: "6", colors: ["#ff3b1f", "#ff6a1f", "#ffb01f", "#ff6a1f"], rate: 5 }, { key: "5", colors: ["#ffd23f", "#ffe9a8", "#ffd23f", "#b8860b"], rate: 3 }],
  },
};
type KeeperDesign = Design & { rows: readonly string[] };
/** The designs, plus `rows`: the standing body grid (every frame and pose shares its size; kick.ts sizes the Friend from it). */
export const KEEPER_DESIGNS: Readonly<Record<KeeperId, KeeperDesign>> = Object.fromEntries(
  Object.entries(DESIGNS).map(([id, design]) => [id, { ...design, rows: design.body }]),
) as unknown as Record<KeeperId, KeeperDesign>;

/** Octopus skirt: a rim row, then outlined tentacles hanging from `cols`, curling by `phase` (0–3). */
function tentacles(width: number, cols: number[], length: number, phase: number, amp = 1) {
  const rows = Array.from({ length: length + 1 }, () => Array(width + 2).fill("."));
  for (let c = 1; c <= width; c++) rows[0][c] = c === 1 || c === width ? "1" : "2";
  cols.forEach((col, i) => {
    for (let r = 1; r <= length; r++) {
      const off = Math.round(Math.sin(phase * (Math.PI / 2) + i * 1.9 + r * 0.8) * amp * ((r - 1) / Math.max(1, length - 1)));
      const x = 1 + col + off, tip = r === length;
      if (x < 0 || x + 1 >= width + 2) continue;
      rows[r][x] = "1"; rows[r][x + 1] = tip ? "1" : r === length - 1 ? "3" : "2";
    }
  });
  return rows.map(row => row.join(""));
}
/** Ghost sheet hem: two rows of scallops shifted by `phase`. */
function hem(width: number, phase: number) {
  const top = [], bottom = [];
  for (let c = 0; c < width; c++) {
    const k = (c + phase) % 3;
    top.push(c === 0 || c === width - 1 ? "1" : k === 2 ? "1" : "2");
    bottom.push(k === 0 ? "1" : ".");
  }
  return [top.join(""), bottom.join("")];
}

// ── Frame composition ────────────────────────────────────────────────────────
const grid = (rows: readonly string[]) => rows.map(row => [...row]);
/** Remove row r and push everything above it down one row (breath, crouch, tuck, landing squash). */
function sink(rows: string[][], r: number) { const w = rows[0].length; rows.splice(r, 1); rows.unshift(Array(w).fill(".")); }
function stamp(target: string[][], part: readonly string[], at: Cell, behind: boolean, outline: boolean) {
  const [c0, r0] = at, h = target.length, w = target[0].length;
  const set = (c: number, r: number, ch: string, back: boolean) => {
    if (r < 0 || r >= h || c < 0 || c >= w) return;
    if (back && target[r][c] !== ".") return;
    target[r][c] = ch;
  };
  if (outline) part.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === ".") return;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if ((part[r + dr]?.[c + dc] ?? ".") === ".") set(c0 + c + dc, r0 + r + dr, "1", true);
  }));
  part.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== ".") set(c0 + c, r0 + r, ch, behind); }));
}
/** Expressions by recolouring opaque face pixels only (eyes: top pixel of each eye; tall = 2 px eyes). */
function applyFace(rows: string[][], face: Face, mood: "blink" | "happy" | "wink" | "sad" | null, offset: number) {
  if (!mood) return;
  const put = (c: number, r: number, ch: string) => { const row = rows[r + offset]; if (row && row[c + offset] !== undefined && row[c + offset] !== ".") row[c + offset] = ch; };
  const eyes = mood === "wink" ? face.eyes.slice(0, Math.max(1, face.eyes.length / 2)) : face.eyes;
  for (const [c, r] of eyes) {
    if (face.tall) {
      if (mood === "blink" || mood === "wink") { put(c, r, face.skin); put(c, r + 1, "1"); }
      else if (mood === "happy") { put(c, r, "1"); put(c, r + 1, face.skin); }
      else { put(c, r, face.skin); put(c, r + 1, "6"); }
    } else put(c, r, mood === "blink" || mood === "wink" ? face.skin : "1");
  }
  if (mood !== "blink") for (const [c, r] of face.mouth) put(c, r, mood === "sad" ? "1" : "6");
}
/** Peacock tail fan: a half-disc of eye-spotted feathers behind the body, leaning with the tell. */
function drawFan(rows: string[][], cx: number, cy: number, radius: number, lean: number, phase: number) {
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[0].length; c++) {
    if (rows[r][c] !== ".") continue;
    const dx = c + 0.5 - cx, dy = cy - (r + 0.5);
    if (dy < -0.5) continue;
    const d = Math.hypot(dx, dy), a = Math.atan2(dx, Math.max(0.01, dy)) - lean * 0.35;
    if (d > radius || Math.abs(a) > 1.3) continue;
    const spoke = Math.round(a / 0.26), off = Math.abs(a - spoke * 0.26) * d;
    let ch = "2";
    if (d > radius - 1 || Math.abs(a) > 1.3 - 1 / Math.max(1, d)) ch = "1";
    else if (Math.abs(d - (radius - 2.6)) < 1.1 && off < 1.1) ch = off < 0.55 && Math.abs(d - (radius - 2.6)) < 0.6 ? (phase % 2 ? "4" : "7") : "3";
    else if (off < 0.4) ch = "8";
    else if (d > radius - 4.6 && d < radius - 3.8) ch = "9";
    rows[r][c] = ch;
  }
}

export type ComposedKeeper = { rows: string[]; pad: number };
const composeCache = new Map<string, ComposedKeeper>();
/**
 * The pixel rows of one keeper frame. Physics poses (set / launch / stretch) ignore `phase` and
 * `lean` and have no margin: they are the exact pixels the engine's masks were generated from.
 */
export function keeperRows(id: KeeperId, look: KeeperLook, phase = 0, lean = 0): ComposedKeeper {
  const physics = PHYSICS_LOOKS.includes(look);
  if (physics) { phase = 0; lean = 0; }
  const key = `${id}:${look}:${phase}:${Math.sign(lean)}`, cached = composeCache.get(key);
  if (cached) return cached;
  const design = KEEPER_DESIGNS[id], onDive = DIVE_LOOKS.includes(look);
  const base = onDive ? design.dive : design.body, margin = physics ? 0 : PAD;
  const rows = grid(base.map(row => ".".repeat(margin) + row + ".".repeat(margin)));
  for (let i = 0; i < margin; i++) rows.unshift(Array(rows[0].length).fill("."));
  const animated = look === "idle" || look === "breathe" || look === "blink" || look === "cheer" || look === "taunt" || look === "land";
  if (design.fan && !physics && !onDive) drawFan(rows, margin + base[0].length / 2, margin + 11.5, look === "cheer" || look === "taunt" ? 12 : 10.5, look === "sad" ? 0 : lean, phase);
  for (const part of design.parts) {
    if (part.displayOnly && physics) continue;
    const at = onDive ? part.dive : part.body;
    if (!at) continue;
    const frames = onDive ? part.diveFrames ?? part.frames : part.frames;
    const index = onDive ? (look === "launch" ? 0 : look === "stretch" ? frames.length - 1 : phase % frames.length)
      : animated ? phase % frames.length : Math.min(frames.length - 1, part.still ?? 0);
    stamp(rows, frames[index], [at[0] + margin, at[1] + margin], part.behind ?? false, part.outline ?? false);
  }
  const face = onDive ? design.diveFace : design.face;
  const mood = look === "blink" ? "blink" : look === "cheer" ? "happy" : look === "taunt" ? "wink" : look === "sad" ? "sad" : look === "land" ? null : null;
  if (face) applyFace(rows, face, mood, margin);
  if (design.shimmer && !physics) {
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) if (rows[r][c] !== ".") rows[r][c] = design.shimmer(rows[r][c], c - margin, r - margin, phase);
  }
  // Shape ops, bottom-up so row indices stay valid: the set crouch, the breath, the tuck and the landing squash.
  if (look === "set" && design.crouch !== null) sink(rows, design.crouch + margin);
  if (look === "breathe" && design.chest !== null) sink(rows, design.chest + margin);
  if ((look === "launch" || look === "land") && design.tuck !== null) sink(rows, design.tuck + margin);
  if (look === "land" && design.tuck !== null) sink(rows, design.tuck - 2 + margin);
  if (look === "sad" && design.chest !== null) sink(rows, design.chest + margin);
  const result = { rows: rows.map(row => row.join("")), pad: margin };
  composeCache.set(key, result);
  return result;
}
/** The opaque-pixel mask of a frame ('#' / '.'), as stored in the engine's KEEPER_RIGS. */
export const keeperMask = (id: KeeperId, pose: RigPose) => keeperRows(id, pose).rows.map(row => [...row].map(ch => (KEEPER_DESIGNS[id].palette[ch] ? "#" : ".")).join(""));

/** The palette at a moment: colour cycles advance with time (frozen under reduced motion). */
function paletteAt(design: Design, time: number, reduced: boolean): { palette: Palette; key: string } {
  if (!design.cycles || reduced) return { palette: design.palette, key: "0" };
  const palette: Record<string, string> = { ...design.palette }, keys: number[] = [];
  for (const cycle of design.cycles) { const i = Math.floor(time * cycle.rate) % cycle.colors.length; palette[cycle.key] = cycle.colors[i]; keys.push(i); }
  return { palette, key: keys.join("") };
}
function keeperSprite(id: KeeperId, look: KeeperLook, phase: number, lean: number, time: number, reduced: boolean) {
  const design = KEEPER_DESIGNS[id], composed = keeperRows(id, look, phase, lean), colours = paletteAt(design, time, reduced);
  return { image: sprite(`keeper-${id}-${look}-${phase}-${Math.sign(lean)}-${colours.key}`, composed.rows, colours.palette), pad: composed.pad };
}

export type KeeperPose = {
  x: number; y: number;              // screen position of the feet
  rotate: number; stretch: number;   // whole-body dive rotation, vertical stretch
  armL: number; armR: number;        // arm angles (radians, 0 = straight out sideways, negative = up)
  alpha: number; scaleMul: number;
  mood: "idle" | "set" | "taunt" | "dive" | "celebrate" | "sad";
  /** Reduced motion: no breathing, sway, colour cycles or trails (poses still read). */
  reduced?: boolean;
  /** The pre-kick lean (peacock's fan points with it). */
  lean?: number;
};

/** Which display frame a pose shows at `time`: breath, blinks and the parts' sway phase. */
export function lookFor(mood: KeeperPose["mood"], time: number, reduced = false): { look: KeeperLook; phase: number } {
  // ((n % 4) + 4) % 4: a sprite frame 0–3 even if time is ever negative (a negative phase has no frame and threw).
  const phase = reduced ? 0 : ((Math.floor(time * (mood === "celebrate" || mood === "taunt" ? 9 : 5)) % 4) + 4) % 4;
  switch (mood) {
    case "set": return { look: "set", phase: 0 };
    case "dive": return { look: "stretch", phase: 0 };
    case "celebrate": return { look: "cheer", phase };
    case "taunt": return { look: "taunt", phase };
    case "sad": return { look: "sad", phase: 0 };
    default: {
      if (time % 3.3 < 0.13) return { look: "blink", phase };
      if (!reduced && Math.floor(time * 1.4) % 2 === 1) return { look: "breathe", phase };
      return { look: "idle", phase };
    }
  }
}

/** Translucent, never-solid flourishes: disco sparkle, ghost afterimage, wall dust, sloth drool bubble. */
function drawKeeperFx(context: CanvasRenderingContext2D, id: KeeperId, w: number, h: number, s: number, time: number, image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number) {
  if (id === "disco") {
    for (let i = 0; i < 4; i++) {
      const t = time * 2.3 + i * 1.7, on = Math.sin(t * 3) > 0.4;
      if (!on) continue;
      const x = Math.round(Math.sin(i * 2.1 + Math.floor(t)) * w * 0.55), y = Math.round(-h / 2 - s + Math.cos(i * 1.3 + Math.floor(t)) * s * 2.5);
      context.fillStyle = "#ffffffcc"; context.fillRect(x, y - 2, 1, 5); context.fillRect(x - 2, y, 5, 1);
    }
  }
  if (id === "ghost") {
    context.save(); context.globalAlpha *= 0.18;
    context.drawImage(image, dx - Math.round(Math.sin(time * 3) * s * 2) - s, dy + s, dw, dh);
    context.restore();
  }
  if (id === "finalwall") {
    context.fillStyle = "#b0664f";
    for (let i = 0; i < 3; i++) { const t = (time * 0.7 + i / 3) % 1; context.globalAlpha = 1 - t; context.fillRect(Math.round((i - 1) * w * 0.35), Math.round(-h / 4 + t * h * 0.7), 1, 1); }
    context.globalAlpha = 1;
  }
}

/** Draws the keeper body (whole-sprite transforms) and procedural arms/gloves. */
export function drawKeeper(context: CanvasRenderingContext2D, id: KeeperId, pose: KeeperPose, time: number) {
  const design = KEEPER_DESIGNS[id], reduced = pose.reduced ?? false;
  const { look, phase } = lookFor(pose.mood, time, reduced);
  const { image, pad: margin } = keeperSprite(id, look, phase, pose.lean ?? 0, time, reduced);
  const s = design.scale * pose.scaleMul, w = design.body[0].length * s, h = design.body.length * s;
  // Celebration hop and taunt bob (whole-sprite translate only).
  const hop = reduced ? 0 : pose.mood === "celebrate" ? Math.abs(Math.sin(time * 9)) * s * 2 : pose.mood === "taunt" ? Math.abs(Math.sin(time * 6)) * s : 0;
  context.save();
  context.globalAlpha = pose.alpha;
  // Shadow (shrinks while hopping).
  context.fillStyle = "#00000044";
  context.beginPath(); context.ellipse(pose.x, pose.y + 1, w * 0.45 - hop * 0.3, 3, 0, 0, Math.PI * 2); context.fill();
  context.translate(Math.round(pose.x), Math.round(pose.y - h / 2 - hop));
  context.rotate(pose.rotate);
  context.scale(1, pose.stretch);
  // Arms behind body for dives look fine; draw arms first then body, then gloves on top.
  const shoulder = -h / 2 + design.shoulderY * s + (look === "breathe" || look === "sad" ? s : 0), len = design.armLength * s;
  const arms: [number, number][] = [];
  for (const [side, angle] of [[-1, pose.armL], [1, pose.armR]] as const) {
    const sx = side * w * 0.3, a = side < 0 ? Math.PI - angle : angle;
    const hx = sx + Math.cos(a) * len, hy = shoulder + Math.sin(a) * len;
    arms.push([hx, hy]);
    context.strokeStyle = design.arm; context.lineWidth = Math.max(2, Math.round(s * 1.2)); context.lineCap = "round";
    context.beginPath(); context.moveTo(sx, shoulder); context.lineTo(hx, hy); context.stroke();
  }
  const dx = -w / 2 - margin * s, dy = -h / 2 - margin * s, dw = image.width * s, dh = image.height * s;
  if (!reduced) drawKeeperFx(context, id, w, h, s, time, image, dx, dy, dw, dh);
  context.drawImage(image, dx, dy, dw, dh);
  const g = Math.max(3, Math.round(s * 2));
  for (const [hx, hy] of arms) {
    context.fillStyle = "#111"; context.fillRect(Math.round(hx - g / 2) - 1, Math.round(hy - g / 2) - 1, g + 2, g + 2);
    context.fillStyle = design.glove; context.fillRect(Math.round(hx - g / 2), Math.round(hy - g / 2), g, g);
  }
  context.restore();
  return { hands: arms, width: w, height: h };
}

/** Arm angles per mood: bounce on toes, the ready crouch, taunt, dive stretch, celebrate, slump. */
export function keeperArms(id: KeeperId, mood: KeeperPose["mood"], time: number, diveX: number, diveY: number): [number, number] {
  const wobble = Math.sin(time * 6) * 0.15;
  switch (mood) {
    case "set": return [0.35, 0.35]; // the engine's standing frame (ARM_IDLE), so the strike hand-off is seamless
    case "taunt":
      if (id === "mime") return [-0.2 + Math.sin(time * 3) * 0.1, -0.2 - Math.sin(time * 3) * 0.1];
      if (id === "disco") return [-1.4 + Math.sin(time * 4) * 0.2, 0.7];
      if (id === "robot") return [-0.1 + (Math.floor(time * 4) % 2) * 0.4, -0.1 - (Math.floor(time * 4) % 2) * 0.4];
      if (id === "sumo") return [0.9, 0.9];
      return [-1.2 + wobble, -1.2 - wobble];
    case "dive": { const up = diveY > 0.6 ? -1.1 : diveY > 0.35 ? -0.4 : 0.2; return diveX < 0 ? [up, up + 0.5] : [up + 0.5, up]; }
    case "celebrate": return [-1.3 + Math.sin(time * 14) * 0.3, -1.3 - Math.sin(time * 14) * 0.3];
    case "sad": return [1.2, 1.2];
    default: return [0.35 + wobble, 0.35 - wobble];
  }
}

export const KEEPER_TAUNTS: Readonly<Record<KeeperId, string[]>> = {
  mouse: ["Squeak!", "Aim low, I dare you"], squirrel: ["Nuts to you!", "Too slow!"], sloth: ["...zzz... saved", "Wake me for the next one"],
  peacock: ["Did you see that?!", "Gorgeous, darling"], octopus: ["Four arms, zero goals", "Inked!"], mime: ["...", "(invisible applause)"],
  disco: ["Stayin' in goal!", "Feel the beat!"], sumo: ["HOOAH!", "Nothing gets past Bento"], chameleon: ["Surprise!", "Didn't see me?"],
  robot: ["PATTERN LEARNED", "PREDICTABLE HUMAN"], ghost: ["Boo!", "Right through you"], finalwall: ["YOU SHALL NOT SCORE", "THE WALL STANDS"],
};

// ── Penalty dives: drawn from the engine's KeeperFrame (the physics hitbox) ──────
/** Goal-art px of an iso goal-unit point (x across, y = height; GOAL.cx 240, goal line 176, 90 px per unit). */
export const artPoint = (p: { x: number; y: number }) => ({ x: 240 + p.x * ART_UNIT, y: 176 - p.y * ART_UNIT });
/**
 * Everything drawKeeperFrame puts on screen while the ball can still touch the keeper, in goal-art
 * px: the body sprite (centre, rotation, size, and the exact pixel rows of the frame's pose), arms
 * (canvas-local to the body centre), gloves (outer size incl. outline), trailing leg and wall.
 * Pure (no canvas), so tests can check the drawn keeper against the physics.
 */
export function keeperArt(frame: KeeperFrame) {
  const design = KEEPER_DESIGNS[frame.id], centre = artPoint(frame);
  const rows = keeperRows(frame.id, frame.pose).rows;
  const w = rows[0].length * design.scale, h = rows.length * design.scale;
  const local = (p: { x: number; y: number }) => ({ x: p.x * ART_UNIT, y: -p.y * ART_UNIT });
  return {
    x: centre.x, y: centre.y, rotate: frame.rotate, w, h, rows, scale: design.scale,
    arms: frame.arms.map(arm => ({ shoulder: local(arm.shoulder), hand: local(arm.hand) })),
    armWidth: frame.armWidth * ART_UNIT, glove: frame.glove * ART_UNIT,
    leg: frame.leg ? { hip: artPoint(frame.leg.hip), foot: artPoint(frame.leg.foot), r: LEG_RADIUS * ART_UNIT } : null,
    wall: frame.wall ? { x0: 240 + Math.max(-1, frame.wall[0]) * ART_UNIT, x1: 240 + Math.min(1, frame.wall[1]) * ART_UNIT, y0: 176 - GOAL_ASPECT * ART_UNIT, y1: 176 } : null,
  };
}

export type KeeperFrameOptions = {
  alpha?: number;
  /** After-save / after-goal arm angles (never while the ball is in flight). */
  arms?: [number, number];
  /** Seconds since the ball crossed the line (omit while it is in flight). Past 0.12 s a dive lands. */
  after?: number;
  /** The keeper's reaction once the ball is dealt with. */
  mood?: "celebrate" | "sad";
  /** Seconds since the strike (drives colour cycles and trails) and reduced motion. */
  time?: number; reduced?: boolean;
  /**
   * A glove save's glint: seconds since the ball met the glove, and where (screen px). A pixel star
   * flashes on the glove nearest that point for GLINT_SECONDS (a static star under reduced motion).
   * Drawn on top of the glove only: it is not part of the sprite, the mask or the hitbox.
   */
  glint?: { t: number; x: number; y: number };
};
export const GLINT_SECONDS = 0.5;
/**
 * Draws a diving keeper exactly where the physics has him: the pose's sprite, arms, gloves and
 * (when the dive leaves one) the trailing leg with its boot. While the ball is in flight nothing
 * opaque is drawn that the physics does not have; after the crossing (`after` > 0.12 s) a dive
 * shows its landing frame and the mood's face.
 */
export function drawKeeperFrame(context: CanvasRenderingContext2D, frame: KeeperFrame, options: KeeperFrameOptions = {}) {
  const design = KEEPER_DESIGNS[frame.id], art = keeperArt(frame), time = options.time ?? 0, reduced = options.reduced ?? false;
  const landed = options.after !== undefined && options.after > 0.12;
  const look: KeeperLook = !landed ? frame.pose : frame.pose === "set" ? (options.mood === "sad" ? "sad" : options.mood === "celebrate" ? "cheer" : "set") : "land";
  const phase = landed && !reduced ? ((Math.floor(time * 6) % 4) + 4) % 4 : 0;
  const { image, pad: margin } = keeperSprite(frame.id, look, phase, 0, time, reduced);
  const s = art.scale;
  context.save();
  context.globalAlpha = options.alpha ?? 1;
  context.fillStyle = "#00000044";
  context.beginPath(); context.ellipse(art.x, 177, art.w * 0.45, 3, 0, 0, Math.PI * 2); context.fill();
  if (frame.id === "ghost" && frame.progress > 0 && !reduced && time < 0.8) {
    // Blink afterimage where the ghost left from: translucent, fading, never solid.
    const home = artPoint({ x: 0, y: art.h / 2 / ART_UNIT });
    context.save(); context.globalAlpha *= 0.25 * Math.max(0, 1 - time / 0.8);
    context.drawImage(keeperSprite("ghost", "set", 0, 0, 0, true).image, home.x - art.w / 2, home.y - art.h / 2, art.w, art.h);
    context.restore();
  }
  if (art.leg) {
    // The trailing leg: a thick sock-coloured leg with a dark boot, so the save is readable.
    context.lineCap = "round"; context.strokeStyle = "#111"; context.lineWidth = art.leg.r * 2;
    context.beginPath(); context.moveTo(art.leg.hip.x, art.leg.hip.y); context.lineTo(art.leg.foot.x, art.leg.foot.y); context.stroke();
    context.strokeStyle = design.arm; context.lineWidth = art.leg.r * 2 - 2;
    context.beginPath(); context.moveTo(art.leg.hip.x, art.leg.hip.y); context.lineTo(art.leg.foot.x, art.leg.foot.y); context.stroke();
    context.fillStyle = "#111"; context.beginPath(); context.arc(art.leg.foot.x, art.leg.foot.y, art.leg.r, 0, Math.PI * 2); context.fill();
    context.fillStyle = design.glove; context.fillRect(Math.round(art.leg.foot.x) - 1, Math.round(art.leg.foot.y) - 1, 2, 2);
  }
  context.translate(art.x, art.y);
  context.rotate(art.rotate);
  const hands = options.arms
    ? options.arms.map((angle, i) => { const side = i ? 1 : -1, a = side < 0 ? Math.PI - angle : angle, sh = art.arms[i].shoulder, len = Math.hypot(art.arms[i].hand.x - sh.x, art.arms[i].hand.y - sh.y); return { shoulder: sh, hand: { x: sh.x + Math.cos(a) * len, y: sh.y + Math.sin(a) * len } }; })
    : art.arms;
  context.strokeStyle = design.arm; context.lineWidth = art.armWidth; context.lineCap = "round";
  for (const arm of hands) { context.beginPath(); context.moveTo(arm.shoulder.x, arm.shoulder.y); context.lineTo(arm.hand.x, arm.hand.y); context.stroke(); }
  context.drawImage(image, -art.w / 2 - margin * s, -art.h / 2 - margin * s, image.width * s, image.height * s);
  const g = art.glove;
  for (const { hand } of hands) {
    context.fillStyle = "#111"; context.fillRect(hand.x - g / 2, hand.y - g / 2, g, g);
    context.fillStyle = design.glove; context.fillRect(hand.x - g / 2 + 1, hand.y - g / 2 + 1, g - 2, g - 2);
  }
  const glint = options.glint;
  if (glint && glint.t >= 0 && glint.t < GLINT_SECONDS) {
    // The glove nearest the contact point (hands are body-local: rotate them back to the screen).
    const cos = Math.cos(art.rotate), sin = Math.sin(art.rotate);
    let best = hands[0].hand, bestD = Infinity;
    for (const { hand } of hands) { const d = Math.hypot(art.x + hand.x * cos - hand.y * sin - glint.x, art.y + hand.x * sin + hand.y * cos - glint.y); if (d < bestD) { bestD = d; best = hand; } }
    const len = reduced ? 4 : Math.round(2 + 5 * Math.sin((glint.t / GLINT_SECONDS) * Math.PI));
    context.rotate(-art.rotate);
    const sx = Math.round(best.x * cos - best.y * sin - g / 4), sy = Math.round(best.x * sin + best.y * cos - g / 4);
    pixelStar(context, sx, sy, len, "#ffffff");
  }
  context.restore();
}

/** Every frame the Showroom reviews, in order (look, phase, label). */
export const KEEPER_SHEET: readonly { look: KeeperLook; phase: number; label: string; physics?: boolean }[] = [
  { look: "idle", phase: 0, label: "idle" }, { look: "breathe", phase: 1, label: "breathe" }, { look: "idle", phase: 2, label: "idle 3" },
  { look: "breathe", phase: 3, label: "breathe 4" }, { look: "blink", phase: 0, label: "blink" },
  { look: "set", phase: 0, label: "SET", physics: true }, { look: "launch", phase: 0, label: "LAUNCH", physics: true }, { look: "stretch", phase: 0, label: "STRETCH", physics: true },
  { look: "land", phase: 0, label: "land" }, { look: "cheer", phase: 0, label: "cheer" }, { look: "cheer", phase: 2, label: "cheer 3" },
  { look: "taunt", phase: 1, label: "taunt" }, { look: "sad", phase: 0, label: "sad" },
];
/** Draw one sheet frame (showroom): the sprite only, feet at (x, y), `scale` screen px per sprite px. */
export function drawKeeperLook(context: CanvasRenderingContext2D, id: KeeperId, look: KeeperLook, phase: number, x: number, y: number, scale: number, options: { lean?: number; time?: number; reduced?: boolean } = {}) {
  const { image, pad: margin } = keeperSprite(id, look, phase, options.lean ?? 0, options.time ?? 0, options.reduced ?? false);
  const design = KEEPER_DESIGNS[id], w = design.body[0].length * scale, h = design.body.length * scale;
  context.drawImage(image, Math.round(x - w / 2 - margin * scale), Math.round(y - h - margin * scale), image.width * scale, image.height * scale);
}
