// Shrinks a screenshot PNG to an 8-bit palette PNG (≤ 256 colours: exact when the image has that few, else a median
// cut like scripts/lib/gif.mjs). Pixel-art UI keeps its look and the file drops well under the 150 KB review budget.
import { deflateSync } from "node:zlib";
import { decodePng, medianCut, key15 } from "./gif.mjs";

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = buffer => { let c = ~0; for (const byte of buffer) c = CRC[(c ^ byte) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (type, data) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};

/** RGB(A) PNG buffer → palette PNG buffer. */
export function shrinkPng(buffer) {
  const { width, height, rgb } = decodePng(buffer), count = width * height;
  const exact = new Map();
  for (let i = 0; i < count && exact.size <= 256; i++) { const k = (rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2]; if (!exact.has(k)) exact.set(k, exact.size); }
  let palette, indexOf;
  if (exact.size <= 256) {
    palette = [...exact.keys()].map(k => [k >> 16, (k >> 8) & 255, k & 255]);
    indexOf = i => exact.get((rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2]);
  } else {
    const histogram = new Map();
    for (let i = 0; i < count; i++) { const k = key15(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]); histogram.set(k, (histogram.get(k) ?? 0) + 1); }
    palette = medianCut(histogram, 256);
    const table = new Int16Array(32768).fill(-1);
    indexOf = i => {
      const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2], k = key15(r, g, b);
      if (table[k] < 0) { let best = 0, dist = Infinity; palette.forEach(([pr, pg, pb], n) => { const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2; if (d < dist) { dist = d; best = n; } }); table[k] = best; }
      return table[k];
    };
  }
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = indexOf(y * width + x);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 3;
  const plte = Buffer.alloc(palette.length * 3); palette.forEach(([r, g, b], n) => { plte[n * 3] = r; plte[n * 3 + 1] = g; plte[n * 3 + 2] = b; });
  return Buffer.concat([buffer.subarray(0, 8), chunk("IHDR", ihdr), chunk("PLTE", plte), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
