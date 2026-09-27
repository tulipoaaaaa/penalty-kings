/**
 * Seen-moment tracking for the Discovery meter ("Seen 14/60 moments"). Encoded as a bitset over the
 * permanent catalogue order, in base64url, so it fits in progress JSON and save codes (60 moments → 10 chars).
 */
import { MOMENTS } from "./moments.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function encodeSeen(seen: Iterable<string>): string {
  const bits = new Array<number>(Math.ceil(MOMENTS.length / 6)).fill(0), set = new Set(seen);
  MOMENTS.forEach((moment, i) => { if (set.has(moment.id)) bits[Math.floor(i / 6)] |= 1 << (i % 6); });
  let text = bits.map(value => ALPHABET[value]).join("");
  while (text.endsWith("A")) text = text.slice(0, -1);
  return text;
}

/** Unknown characters are ignored; bits past the catalogue (a newer save on an older build) are dropped. */
export function decodeSeen(code: string): string[] {
  const ids: string[] = [];
  [...code].forEach((char, group) => {
    const value = ALPHABET.indexOf(char);
    if (value < 0) return;
    for (let bit = 0; bit < 6; bit++) if (value & (1 << bit)) { const moment = MOMENTS[group * 6 + bit]; if (moment) ids.push(moment.id); }
  });
  return ids;
}

/** "Seen 14/60 moments". */
export function discovery(seen: Iterable<string>) {
  const set = new Set(seen), known = MOMENTS.filter(moment => set.has(moment.id));
  return { seen: known.length, total: MOMENTS.length, label: `Seen ${known.length}/${MOMENTS.length} moments`, missing: MOMENTS.filter(moment => !set.has(moment.id)).map(({ id, name }) => ({ id, name })) };
}
