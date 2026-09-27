// Pure weekly computation (no network): $GBOOT drops and the Golden Boot race from on-chain events.
// Inputs are decoded events; scripts/cup/weekly.mjs fetches them, tests feed synthetic ones.
export const DROP_MULT = [1, 1.5, 2, 3, 5, 8, 15];
export const RACE_POINTS = [0, 0, 0, 0, 0, 1, 2];
export const WEIGHT = { park: 1, pro: 100, champions: 1000 };
/** Wildcard draws count at the Park weight: a Wildcard costs about one Park ball (docs/ECONOMY.md). */
export const WILDCARD_WEIGHT = 1;
export const CURVE = [25, 18, 13, 10, 8, 7, 6, 5, 4, 4];

/**
 * @param {{ settled: { tier: string, friendId: string, outcomeId: number }[], wildcards: { friendId: string, points: number }[],
 *           base: Record<string, number>, potRf?: number }} input
 */
export function computeWeek({ settled, wildcards = [], base, potRf = 0 }) {
  const friends = new Map();
  const row = id => { if (!friends.has(id)) friends.set(id, { friendId: id, balls: 0, drops: 0, race: 0, wildcardPoints: 0 }); return friends.get(id); };
  for (const event of settled) {
    const index = event.outcomeId - 1;
    if (!(index >= 0 && index < 7) || !(event.tier in WEIGHT)) throw new Error(`bad settle event ${JSON.stringify(event)}`);
    const r = row(event.friendId);
    r.balls += 1; r.drops += base[event.tier] * DROP_MULT[index]; r.race += RACE_POINTS[index] * WEIGHT[event.tier];
  }
  for (const draw of wildcards) {
    if (![0, 1, 2].includes(draw.points)) throw new Error(`bad wildcard event ${JSON.stringify(draw)}`);
    const r = row(draw.friendId);
    r.wildcardPoints += draw.points * WILDCARD_WEIGHT; r.race += draw.points * WILDCARD_WEIGHT;
  }
  const rows = [...friends.values()].map(r => ({ ...r, drops: Math.floor(r.drops) }));
  const race = rows.filter(r => r.race > 0).sort((a, b) => b.race - a.race || Number(BigInt(a.friendId) - BigInt(b.friendId))).slice(0, 10);
  const cup = race.map((r, index) => ({ rank: index + 1, friendId: r.friendId, points: r.race, shareBps: CURVE[index] * 100, rf: Math.floor((potRf * CURVE[index]) / 100) }));
  return { rows: rows.sort((a, b) => b.drops - a.drops), cup };
}
