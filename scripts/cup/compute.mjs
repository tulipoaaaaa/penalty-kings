// Pure weekly computation (no network): $GBOOT drops and the Golden Boot race from on-chain events.
// Inputs are decoded events; scripts/cup/weekly.mjs fetches them, tests feed synthetic ones.
// Tokenomics v2 (round 6): lacing is progression only. Bootroom perk tiers (0–3) annotate each Friend
// (XP bonus, cosmetics, Cup seeding order) and NEVER change drops, race points or Cup ranks. Also the
// drop vault's halving weekly cap (EmissionVault.capOf) and the EdgeSplitter 40/30/30 split.
import { VAULTS, capOfWei, splitEdgeWei, DROP_SHARE, PERKS } from "../lib/tokenomics.mjs";

export const DROP_MULT = [1, 1.5, 2, 3, 5, 8, 15];
export const RACE_POINTS = [0, 0, 0, 0, 0, 1, 2];
export const WEIGHT = { park: 1, pro: 100, champions: 1000 };
/** Launch schedule per ball at ×1 (games/penalty-kings/economy.ts TIERS baseDrop). */
export const SCHEDULE = { park: 0.93, pro: 93, champions: 930 };
export const PRICE = { park: 10, pro: 1000, champions: 10000 };
/** Wildcard draws count at the Park weight: a Wildcard costs about one Park ball (docs/ECONOMY.md). */
export const WILDCARD_WEIGHT = 1;
export const CURVE = [25, 18, 13, 10, 8, 7, 6, 5, 4, 4];

/** Drop base per stadium for a week: min(schedule, 2% × ball price ÷ TWAP ÷ 2.15). No TWAP → schedule. */
export function baseFor(twap) {
  if (!(twap > 0)) return { ...SCHEDULE };
  return Object.fromEntries(Object.entries(SCHEDULE).map(([tier, s]) => [tier, Math.min(s, Math.floor(((DROP_SHARE * PRICE[tier]) / twap / 2.15) * 1e4) / 1e4)]));
}

/** The drop vault's budget for vault week `week`, minus what was already released that week (whole $GBOOT). */
export function dropBudget(week, releasedWei = 0n) {
  const cap = capOfWei(VAULTS.drops, week);
  const left = cap > releasedWei ? cap - releasedWei : 0n;
  return { capWei: cap, leftWei: left, left: Number(left / 10n ** 12n) / 1e6 };
}

/** EdgeSplitter.split on `rfWei`: 40% burned, 30% buy-and-burn $GBOOT, 30% to the Cup. */
export const edgeSplit = rfWei => splitEdgeWei(BigInt(rfWei));

/**
 * @param {{ settled: { tier: string, friendId: string, outcomeId: number }[], wildcards?: { friendId: string, points: number }[],
 *           base: Record<string, number>, potRf?: number, perks?: Record<string, number>, budget?: number }} input
 * perks: Bootroom.perkTier per friendId (missing → 0); reported (XP bonus, seeding) but never used by a payout.
 * budget: most $GBOOT the drop vault may pay this week; when the drops exceed it, every Friend's drops are
 * scaled down by the same factor.
 */
export function computeWeek({ settled, wildcards = [], base, potRf = 0, perks = {}, budget = Infinity }) {
  const friends = new Map();
  const row = id => { if (!friends.has(id)) friends.set(id, { friendId: id, balls: 0, rawDrops: 0, rawRace: 0, wildcardPoints: 0 }); return friends.get(id); };
  for (const event of settled) {
    const index = event.outcomeId - 1;
    if (!(index >= 0 && index < 7) || !(event.tier in WEIGHT)) throw new Error(`bad settle event ${JSON.stringify(event)}`);
    const r = row(event.friendId);
    r.balls += 1; r.rawDrops += base[event.tier] * DROP_MULT[index]; r.rawRace += RACE_POINTS[index] * WEIGHT[event.tier];
  }
  for (const draw of wildcards) {
    if (![0, 1, 2].includes(draw.points)) throw new Error(`bad wildcard event ${JSON.stringify(draw)}`);
    const r = row(draw.friendId);
    r.wildcardPoints += draw.points * WILDCARD_WEIGHT; r.rawRace += draw.points * WILDCARD_WEIGHT;
  }
  let rows = [...friends.values()].map(r => {
    const perkTier = perks[r.friendId] ?? 0;
    if (!(Number.isInteger(perkTier) && perkTier >= 0 && perkTier <= 3)) throw new Error(`perk tier out of range for #${r.friendId}: ${perkTier}`);
    // Payouts use the raw figures only: a perk tier is progression (XP bonus, cosmetics, seeding).
    return { ...r, perkTier, xpBonusPct: PERKS[perkTier].xpBonusPct, drops: r.rawDrops, race: r.rawRace };
  });
  const wanted = rows.reduce((s, r) => s + r.drops, 0);
  const scale = wanted > budget ? budget / wanted : 1;
  rows = rows.map(r => ({ ...r, drops: Math.floor(r.drops * scale) }));
  const race = rows.filter(r => r.race > 0).sort((a, b) => b.race - a.race || Number(BigInt(a.friendId) - BigInt(b.friendId))).slice(0, 10);
  const cup = race.map((r, index) => ({ rank: index + 1, friendId: r.friendId, points: r.race, perkTier: r.perkTier, shareBps: CURVE[index] * 100, rf: Math.floor((potRf * CURVE[index]) / 100) }));
  // Cup seeding: display / draw order for next week's Cup (higher perk tier first, then friendId). Not a rank.
  const seeding = [...rows].sort((a, b) => b.perkTier - a.perkTier || Number(BigInt(a.friendId) - BigInt(b.friendId))).map(r => ({ friendId: r.friendId, perkTier: r.perkTier }));
  return { rows: rows.sort((a, b) => b.drops - a.drops), cup, scale, wanted, seeding };
}
