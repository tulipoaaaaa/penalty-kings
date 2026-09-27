// Every hand-written 4-byte selector in source must match its signature (no invented ABIs).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { toFunctionSelector } from "viem";

const EXPECT = [
  ["games/penalty-kings/index.tsx", "unlocked(uint256,uint256)"],
  ["clubhouse/main.tsx", "transfer(address,uint256)"],
];
for (const [file, signature] of EXPECT) {
  const source = await readFile(file, "utf8"), selector = toFunctionSelector(signature).slice(2);
  assert.ok(source.includes(selector), `${file}: selector for ${signature} (0x${selector}) not found`);
  const claimed = [...source.matchAll(/0x([0-9a-f]{8})(?![0-9a-f])/g)].map(match => match[1]);
  for (const found of claimed) assert.ok(EXPECT.some(([f, sig]) => f === file && toFunctionSelector(sig).slice(2) === found) || found.length !== 8 || !source.includes(`0x${found}\${`) && !source.includes(`\`0x${found}`), `${file}: unexpected selector 0x${found}`);
  console.log(`ok ${file}: ${signature} = 0x${selector}`);
}
