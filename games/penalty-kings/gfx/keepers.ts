/**
 * Twelve original keepers. Each body is a palette-indexed 16 × 16 (or larger) pixel array;
 * arms and gloves are drawn per pose so every keeper gets idle / bounce / taunt / dive-left /
 * dive-right / dive-high / celebrate / sad from one body. Signature FX live in drawKeeperFx.
 * '1' outline · '2' main · '3' secondary · '4' highlight · '5' white · '6' dark detail · '7' accent
 */
import type { KeeperId } from "@penalty-kings/engine";
import { sprite, type Palette } from "./core.js";

type Design = { rows: string[]; palette: Palette; arm: string; glove: string; scale: number; shoulderY: number; armLength: number; sfx: "squeak" | "chitter" | "yawn" | "honk" | "blub" | "mime" | "disco" | "stomp" | "hiss" | "beep" | "boo" | "rumble" };

const pad = (rows: string[]) => { const w = Math.max(...rows.map(r => r.length)); return rows.map(r => r.padEnd(w, ".")); };

export const KEEPER_DESIGNS: Readonly<Record<KeeperId, Design>> = {
  mouse: { scale: 2.2, shoulderY: 9, armLength: 6, arm: "#9aa3ad", glove: "#ff8fab", sfx: "squeak", palette: { "1": "#2b2d42", "2": "#9aa3ad", "3": "#ff8fab", "4": "#d7dde5", "5": "#ffffff", "6": "#111111" }, rows: pad([
    "..11.......11...",
    ".1331.....1331..",
    ".13331111133 1..".replace(" ", "3"),
    "..1122222222 1..".replace(" ", "1"),
    "...12222222221..",
    "...12562256221..",
    "...12662266221..",
    "...12222332221..",
    "....122444221...",
    "....122222221...",
    "...12222222221..",
    "...12244444221..",
    "...12244444221..",
    "....122222221...",
    "....11.1.1.11...",
    "...111.....111..",
  ]) },
  squirrel: { scale: 2.8, shoulderY: 8, armLength: 7, arm: "#e07a2e", glove: "#ffd23f", sfx: "chitter", palette: { "1": "#3b1f0f", "2": "#e07a2e", "3": "#f6c28b", "4": "#ffb066", "5": "#ffffff", "6": "#111111" }, rows: pad([
    "...11......11...",
    "..1221....1221..",
    "..122211112221.1",
    "...1222222221.12",
    "...1256225621.12",
    "...1266226621122",
    "...1222332221222",
    "....12233221.122",
    "....1222222211222",
    "...122333332212 2".replace(" ", "2"),
    "...1223333322122",
    "...122333332212.",
    "....12222222111.",
    "....1221.1221...",
    "....111...111...",
  ]) },
  sloth: { scale: 3, shoulderY: 8, armLength: 11, arm: "#8b6b4a", glove: "#c9ecff", sfx: "yawn", palette: { "1": "#2e1f12", "2": "#8b6b4a", "3": "#d9c3a0", "4": "#a98560", "5": "#ffffff", "6": "#111111" }, rows: pad([
    "....11111111....",
    "...1222222221...",
    "..122333333221..",
    "..123663366321..",
    "..123663366321..",
    "..122333333221..",
    "...12233332 1...".replace(" ", "2"),
    "...1222222221...",
    "..122244442221..",
    "..122444444221..",
    "..122444444221..",
    "..122244442221..",
    "...1222222221...",
    "...1221..1221...",
    "...1111..1111...",
  ]) },
  peacock: { scale: 2.8, shoulderY: 8, armLength: 7, arm: "#1d8a8a", glove: "#ffd23f", sfx: "honk", palette: { "1": "#0b2b3a", "2": "#1d8a8a", "3": "#2a6fdb", "4": "#7fd3ff", "5": "#ffffff", "6": "#111111", "7": "#ffd23f" }, rows: pad([
    "......1.1.1.....",
    ".....1717171....",
    "......11111.....",
    ".....1222221....",
    "....125622561...",
    "....126622661...",
    "....122277221...",
    ".....1227221....",
    "....122333221...",
    "...12233333221..",
    "...12234443221..",
    "...12234443221..",
    "....123333321...",
    "....1221.1221...",
    "....1771.1771...",
    "....111...111...",
  ]) },
  octopus: { scale: 2.8, shoulderY: 9, armLength: 9, arm: "#7b3fa0", glove: "#ff9ad5", sfx: "blub", palette: { "1": "#2a0f3a", "2": "#7b3fa0", "3": "#ff9ad5", "4": "#a86cd0", "5": "#ffffff", "6": "#111111" }, rows: pad([
    ".....111111.....",
    "....12222221....",
    "...1224444221...",
    "..122444444221..",
    "..125662256621..",
    "..126662266621..",
    "..122222222221..",
    "...1223333221...",
    "....12222221....",
    "...1222222221...",
    "..1212121212 1..".replace(" ", "2"),
    "..1.21.21.21.21.",
    ".12.12.12.12.12.",
    ".13..13.13..13..",
    "..1...1..1...1..",
  ]) },
  mime: { scale: 2.8, shoulderY: 8, armLength: 7, arm: "#f7f7f2", glove: "#ffffff", sfx: "mime", palette: { "1": "#111111", "2": "#f7f7f2", "3": "#111111", "4": "#ff5a6e", "5": "#ffffff", "6": "#111111", "7": "#2a2a2a" }, rows: pad([
    ".....111111.....",
    "....17777771....",
    "...1111111111...",
    "....12222221....",
    "....16222261....",
    "....12222221....",
    "....12244221....",
    ".....122221.....",
    "....13333331....",
    "...1225555221...",
    "...1333333331...",
    "...1225555221...",
    "....13333331....",
    "....1331.1331...",
    "....111...111...",
  ]) },
  disco: { scale: 2.8, shoulderY: 9, armLength: 7, arm: "#c47a3e", glove: "#ccff00", sfx: "disco", palette: { "1": "#1a0f2e", "2": "#c47a3e", "3": "#ff4fd8", "4": "#6b2fbf", "5": "#ffffff", "6": "#111111", "7": "#ccff00" }, rows: pad([
    "...1111111111...",
    "..144444444441..",
    ".14444444444441.",
    ".14412222221441.",
    "..1125622562 1..".replace(" ", "1"),
    "...1266226621...",
    "...1222552221...",
    "....12222221....",
    "...1333333331...",
    "...1337777331...",
    "...1333333331...",
    "....13333331....",
    "...133311333 1..".replace(" ", "1"),
    "..1333 1..13331.".replace(" ", "3"),
    "..1111...1111...",
  ]) },
  sumo: { scale: 3.2, shoulderY: 7, armLength: 7, arm: "#f2c79a", glove: "#ffd23f", sfx: "stomp", palette: { "1": "#3a1f0a", "2": "#f2c79a", "3": "#1d1d6b", "4": "#ffdcb8", "5": "#ffffff", "6": "#111111", "7": "#111111" }, rows: pad([
    ".....177771.....",
    "....1222 221....".replace(" ", "2"),
    "...12622262 1...".replace(" ", "2"),
    "...1222442221...",
    "..122222222221..",
    ".12222222222221.",
    "1222244444422221",
    "1222444444442221",
    "1222244444422221",
    "1333333333333331",
    "1333333333333331",
    ".12222.....22221",
    ".1222.......2221",
    ".1111.......1111",
  ]) },
  chameleon: { scale: 2.8, shoulderY: 8, armLength: 7, arm: "#3fae4a", glove: "#ffd23f", sfx: "hiss", palette: { "1": "#0f3a14", "2": "#3fae4a", "3": "#b8f06a", "4": "#2a7d33", "5": "#ffffff", "6": "#111111" }, rows: pad([
    "....11111.......",
    "...1222221......",
    "..12555522111...",
    "..12566522222 1.".replace(" ", "2"),
    "..12555522223331".slice(0, 16),
    "..1222222222221.",
    "...122333333 1..".replace(" ", "1"),
    "....12222221....",
    "...1224444221...",
    "...1244444421...",
    "...1224444221...",
    "....12222221.11.",
    "....1221.12211 1".replace(" ", "1"),
    "....111...11111.",
  ]) },
  robot: { scale: 2.8, shoulderY: 8, armLength: 7, arm: "#8a96a8", glove: "#ff5a6e", sfx: "beep", palette: { "1": "#1b1f2e", "2": "#8a96a8", "3": "#d7dde5", "4": "#5a6475", "5": "#ffffff", "6": "#ff5a6e", "7": "#ccff00" }, rows: pad([
    ".......17.......",
    ".......11.......",
    "...1111111111...",
    "...1333333331...",
    "...1366666631...",
    "...1333333331...",
    "...1111111111...",
    ".....122221.....",
    "...1222222221...",
    "...1277422721...",
    "...1244444421...",
    "...1222222221...",
    "....12211221....",
    "....14411441....",
    "....11111111....",
  ]) },
  ghost: { scale: 2.8, shoulderY: 8, armLength: 6, arm: "#cfd8e3", glove: "#e8f4ff", sfx: "boo", palette: { "1": "#6a7a90", "2": "#e8f4ff", "3": "#cfd8e3", "4": "#ffffff", "5": "#ffffff", "6": "#1a1f2b" }, rows: pad([
    ".....111111.....",
    "....12222221....",
    "...1222222221...",
    "..122662266221..",
    "..122662266221..",
    "..122222222221..",
    "..122226622221..",
    "..122222222221..",
    "..122233332221..",
    "..122222222221..",
    "..122222222221..",
    "..122222222221..",
    "..121221122121..",
    "..1.11.11.11.1..",
  ]) },
  finalwall: { scale: 3.4, shoulderY: 7, armLength: 9, arm: "#8d4a3a", glove: "#ffd23f", sfx: "rumble", palette: { "1": "#1a0a06", "2": "#8d4a3a", "3": "#b0664f", "4": "#5e2f25", "5": "#ffd23f", "6": "#ff3b1f", "7": "#ffd23f" }, rows: pad([
    "...1.1.1.1.1....",
    "...1717171711...",
    "..11111111111...",
    ".1233323332321..",
    ".1466614666441..",
    ".1233323332321..",
    ".1444144414441..",
    "12332333233323 1".replace(" ", "1"),
    "14441444144414 1".replace(" ", "1"),
    "12332333233323 1".replace(" ", "1"),
    "14441444144414 1".replace(" ", "1"),
    ".1233323332321..",
    ".12331...12331..",
    ".11111...11111..",
  ]) },
};

export type KeeperPose = {
  x: number; y: number;              // screen position of the feet
  rotate: number; stretch: number;   // whole-body dive rotation, vertical stretch
  armL: number; armR: number;        // arm angles (radians, 0 = straight out sideways, negative = up)
  alpha: number; scaleMul: number;
  mood: "idle" | "taunt" | "dive" | "celebrate" | "sad";
};

/** Draws the keeper body (whole-sprite transforms) and procedural arms/gloves. */
export function drawKeeper(context: CanvasRenderingContext2D, id: KeeperId, pose: KeeperPose, time: number) {
  const design = KEEPER_DESIGNS[id];
  const body = sprite(`keeper-${id}`, design.rows, design.palette);
  const s = design.scale * pose.scaleMul, w = body.width * s, h = body.height * s;
  context.save();
  context.globalAlpha = pose.alpha;
  // Shadow.
  context.fillStyle = "#00000044";
  context.beginPath(); context.ellipse(pose.x, pose.y + 1, w * 0.45, 3, 0, 0, Math.PI * 2); context.fill();
  context.translate(Math.round(pose.x), Math.round(pose.y - h / 2));
  context.rotate(pose.rotate);
  context.scale(1, pose.stretch);
  // Arms behind body for dives look fine; draw arms first then body, then gloves on top.
  const shoulder = -h / 2 + design.shoulderY * s, len = design.armLength * s;
  const arms: [number, number][] = [];
  for (const [side, angle] of [[-1, pose.armL], [1, pose.armR]] as const) {
    const sx = side * w * 0.3, a = side < 0 ? Math.PI - angle : angle;
    const hx = sx + Math.cos(a) * len, hy = shoulder + Math.sin(a) * len;
    arms.push([hx, hy]);
    context.strokeStyle = design.arm; context.lineWidth = Math.max(2, Math.round(s * 1.2)); context.lineCap = "round";
    context.beginPath(); context.moveTo(sx, shoulder); context.lineTo(hx, hy); context.stroke();
  }
  context.drawImage(body, -w / 2, -h / 2, w, h);
  const g = Math.max(3, Math.round(s * 2));
  for (const [hx, hy] of arms) {
    context.fillStyle = "#111"; context.fillRect(Math.round(hx - g / 2) - 1, Math.round(hy - g / 2) - 1, g + 2, g + 2);
    context.fillStyle = design.glove; context.fillRect(Math.round(hx - g / 2), Math.round(hy - g / 2), g, g);
  }
  context.restore();
  return { hands: arms, width: w, height: h };
}

/** Arm angles per mood: bounce on toes, taunt, dive stretch, celebrate, slump. */
export function keeperArms(id: KeeperId, mood: KeeperPose["mood"], time: number, diveX: number, diveY: number): [number, number] {
  const wobble = Math.sin(time * 6) * 0.15;
  switch (mood) {
    case "taunt": return id === "mime" ? [-0.2 + Math.sin(time * 3) * 0.1, -0.2 - Math.sin(time * 3) * 0.1] : [-1.2 + wobble, -1.2 - wobble];
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
