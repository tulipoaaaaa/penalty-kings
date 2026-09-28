/** The SDK fixture Friend (#7730) drawn from its recorded canonical frames (FriendSDK sample art). Never redrawn. */
import { useEffect, useRef } from "react";
import { decodeGenerationSprites, spriteFrame } from "@rarefriends/friendsdk/sprites";
import { CONFIG } from "./config.ts";

let rows: readonly string[] | null = null;
function fixtureRows() {
  if (!rows) {
    const sprites = decodeGenerationSprites(7730n, 5, 7730, CONFIG.fixtureFrames.map(value => BigInt(value)));
    rows = spriteFrame(sprites, "down", false, 0, "right").frame.rows;
  }
  return rows;
}

export function FriendArt({ label = "Friend #7730 (test fixture art)" }: { label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current?.getContext("2d");
    if (!c) return;
    const data = fixtureRows(), s = 4, pad = 2;
    c.clearRect(0, 0, 72, 72);
    // A gold halo (the game's owned-Friend outline style) under the unaltered mask.
    c.fillStyle = "#ffd23f";
    data.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === "#") c.fillRect((x + pad) * s - s, (y + pad) * s - s, s * 3, s * 3); });
    c.fillStyle = "#0b0d1a";
    data.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === "#") c.fillRect((x + pad) * s, (y + pad) * s, s, s); });
  }, []);
  return <canvas ref={canvas} width={72} height={72} role="img" aria-label={label} data-testid="friend-art" />;
}
