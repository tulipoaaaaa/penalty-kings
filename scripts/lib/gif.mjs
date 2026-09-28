// Dependency-free PNG reader and animated-GIF writer for the recording scripts (scripts/record-money-shot.mjs).
// Playwright's bundled ffmpeg can only write VP8/WebM and PNG, so the README's GIF is assembled here from the
// PNG frames ffmpeg writes. Tuned for pixel art: one global 255-colour palette (median cut over every frame),
// and each frame after the first stores only the pixels that visibly changed (the rest are transparent and
// keep the previous frame), cropped to the changed rectangle. That keeps a 15 s clip at 480 × 320 small.
import { inflateSync } from "node:zlib";

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG (what ffmpeg's png encoder writes) to { width, height, rgb }. */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8, width = 0, height = 0, colorType = 0, depth = 0, interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString("latin1", offset + 4, offset + 8), data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported PNG (depth ${depth}, colour type ${colorType}, interlace ${interlace})`);
  const channels = colorType === 6 ? 4 : 3, stride = width * channels, raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height), rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), out = y * stride, up = out - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[out + x - channels] : 0, b = y ? pixels[up + x] : 0, c = y && x >= channels ? pixels[up + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      pixels[out + x] = value & 255;
    }
  }
  for (let i = 0, j = 0; i < width * height; i++, j += channels) { rgb[i * 3] = pixels[j]; rgb[i * 3 + 1] = pixels[j + 1]; rgb[i * 3 + 2] = pixels[j + 2]; }
  return { width, height, rgb };
}

export const key15 = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/** Median cut over a 15-bit colour histogram: up to `size` colours, each the weighted mean of its box. */
export function medianCut(histogram, size) {
  let boxes = [[...histogram.keys()].filter(key => histogram.get(key) > 0)];
  const channel = (key, c) => (key >> (10 - 5 * c)) & 31;
  while (boxes.length < size) {
    let best = -1, bestRange = 0, bestChannel = 0;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let min = 31, max = 0;
        for (const key of box) { const v = channel(key, c); if (v < min) min = v; if (v > max) max = v; }
        const weight = Math.log2(1 + box.reduce((sum, key) => sum + histogram.get(key), 0));
        if ((max - min) * weight > bestRange) { bestRange = (max - min) * weight; best = index; bestChannel = c; }
      }
    });
    if (best < 0) break;
    const box = boxes[best].sort((p, q) => channel(p, bestChannel) - channel(q, bestChannel));
    const total = box.reduce((sum, key) => sum + histogram.get(key), 0);
    let running = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) { running += histogram.get(box[i]); if (running >= total / 2) { cut = i + 1; break; } }
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.map(box => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const key of box) { const w = histogram.get(key); r += (((key >> 10) & 31) * 8 + 4) * w; g += (((key >> 5) & 31) * 8 + 4) * w; b += ((key & 31) * 8 + 4) * w; n += w; }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

/** GIF LZW (variable code width, 8-bit minimum code size) packed into 255-byte sub-blocks. */
function lzw(indices) {
  const CLEAR = 256, END = 257, out = [];
  let width = 9, next = 258, dict = new Map(), bits = 0, acc = 0;
  const emit = code => { acc |= code << bits; bits += width; while (bits >= 8) { out.push(acc & 255); acc >>>= 8; bits -= 8; } };
  emit(CLEAR);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], entry = (prefix << 8) | k, found = dict.get(entry);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) { dict.set(entry, next++); if (next > (1 << width) && width < 12) width++; }
    else { emit(CLEAR); dict = new Map(); next = 258; width = 9; }
    prefix = k;
  }
  emit(prefix); emit(END);
  if (bits > 0) out.push(acc & 255);
  const blocks = [];
  for (let i = 0; i < out.length; i += 255) { const chunk = out.slice(i, i + 255); blocks.push(chunk.length, ...chunk); }
  blocks.push(0);
  return Buffer.from(blocks);
}

/**
 * Encodes frames ({ width, height, rgb }, all the same size) as a looping GIF.
 * delayCs: per-frame delay in 1/100 s. tolerance: a pixel within this RGB distance of what is already on
 * screen is left unchanged (transparent), which also hides tiny video-codec shimmer.
 */
export function encodeGif(frames, { delayCs = 8, tolerance = 14 } = {}) {
  const { width, height } = frames[0], count = width * height, TRANSPARENT = 255;
  const histogram = new Map();
  frames.forEach((frame, f) => { for (let i = f % 2; i < count; i += 2) { const k = key15(frame.rgb[i * 3], frame.rgb[i * 3 + 1], frame.rgb[i * 3 + 2]); histogram.set(k, (histogram.get(k) ?? 0) + 1); } });
  const palette = medianCut(histogram, 255);
  const table = new Uint8Array(32768);
  for (let k = 0; k < 32768; k++) {
    const r = ((k >> 10) & 31) * 8 + 4, g = ((k >> 5) & 31) * 8 + 4, b = (k & 31) * 8 + 4;
    let best = 0, bestDistance = Infinity;
    palette.forEach(([pr, pg, pb], index) => { const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2; if (d < bestDistance) { bestDistance = d; best = index; } });
    table[k] = best;
  }
  const parts = [];
  const header = Buffer.alloc(13); header.write("GIF89a", 0, "latin1"); header.writeUInt16LE(width, 6); header.writeUInt16LE(height, 8); header[10] = 0xf7; header[11] = 0; header[12] = 0;
  const colours = Buffer.alloc(768); palette.forEach(([r, g, b], index) => { colours[index * 3] = r; colours[index * 3 + 1] = g; colours[index * 3 + 2] = b; });
  parts.push(header, colours, Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0", "latin1"), 0x03, 0x01, 0x00, 0x00, 0x00]));
  const shown = new Int16Array(count).fill(-1), limit = tolerance * tolerance;
  for (const frame of frames) {
    const indices = new Uint8Array(count);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let i = 0; i < count; i++) {
      const r = frame.rgb[i * 3], g = frame.rgb[i * 3 + 1], b = frame.rgb[i * 3 + 2], index = table[key15(r, g, b)], was = shown[i];
      if (was >= 0) {
        const [sr, sg, sb] = palette[was];
        if (index === was || (sr - r) ** 2 + (sg - g) ** 2 + (sb - b) ** 2 <= limit) { indices[i] = TRANSPARENT; continue; }
      }
      indices[i] = index; shown[i] = index;
      const x = i % width, y = (i / width) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX < 0) { minX = minY = maxX = maxY = 0; }
    const w = maxX - minX + 1, h = maxY - minY + 1, crop = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) crop.set(indices.subarray((minY + y) * width + minX, (minY + y) * width + minX + w), y * w);
    const control = Buffer.from([0x21, 0xf9, 0x04, (1 << 2) | 1, delayCs & 255, delayCs >> 8, TRANSPARENT, 0]);
    const descriptor = Buffer.alloc(10); descriptor[0] = 0x2c; descriptor.writeUInt16LE(minX, 1); descriptor.writeUInt16LE(minY, 3); descriptor.writeUInt16LE(w, 5); descriptor.writeUInt16LE(h, 7); descriptor[9] = 0;
    parts.push(control, descriptor, Buffer.from([8]), lzw(crop));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}
