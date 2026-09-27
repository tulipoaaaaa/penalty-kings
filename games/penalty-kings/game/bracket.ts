/**
 * Weekly Skill Cup bracket (round 6 D19): groups → knockouts, every kick with the SAME standard ball
 * (no pay-to-win: the ball choice never enters the Skill Cup).
 *
 * Every "match" is two referee-verified 5-kick shootouts against the same keeper, one per player, played
 * asynchronously. A match is decided by points, then goals, then top bins, then the earlier
 * submission. Pure and deterministic: the same entries and results always give the same bracket.
 */
export type Entrant = { id: string; name: string; seedScore: number };
export type Shootout = { points: number; goals: number; topBins: number; submittedAt: number };
export type GroupRow = { id: string; name: string; played: number; wins: number; points: number; goals: number };

export const GROUP_SIZE = 4, ADVANCE_PER_GROUP = 2;

/** Snake seeding by last week's score (or entry order), so each group has one strong, one weaker … entrant. */
export function buildGroups(entrants: readonly Entrant[]): Entrant[][] {
  const sorted = [...entrants].sort((a, b) => b.seedScore - a.seedScore || a.id.localeCompare(b.id));
  const count = Math.max(1, Math.ceil(sorted.length / GROUP_SIZE));
  const groups: Entrant[][] = Array.from({ length: count }, () => []);
  sorted.forEach((entrant, i) => { const lap = Math.floor(i / count), slot = i % count; groups[lap % 2 === 0 ? slot : count - 1 - slot].push(entrant); });
  return groups;
}

/** Winner of a head-to-head from two verified shootouts: points, then goals, then top bins, then earlier submission. */
export function decide(a: Shootout, b: Shootout): "a" | "b" {
  if (a.points !== b.points) return a.points > b.points ? "a" : "b";
  if (a.goals !== b.goals) return a.goals > b.goals ? "a" : "b";
  if (a.topBins !== b.topBins) return a.topBins > b.topBins ? "a" : "b";
  return a.submittedAt <= b.submittedAt ? "a" : "b";
}

/** Round-robin standings from each entrant's group shootouts (one verified shootout per pairing). */
export function standings(group: readonly Entrant[], results: ReadonlyMap<string, Shootout>): GroupRow[] {
  const rows = new Map(group.map(e => [e.id, { id: e.id, name: e.name, played: 0, wins: 0, points: 0, goals: 0 }]));
  for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const a = results.get(`${group[i].id}>${group[j].id}`), b = results.get(`${group[j].id}>${group[i].id}`);
    if (!a || !b) continue;
    const ra = rows.get(group[i].id)!, rb = rows.get(group[j].id)!;
    ra.played++; rb.played++; ra.points += a.points; rb.points += b.points; ra.goals += a.goals; rb.goals += b.goals;
    (decide(a, b) === "a" ? ra : rb).wins++;
  }
  return [...rows.values()].sort((x, y) => y.wins - x.wins || y.points - x.points || y.goals - x.goals || x.id.localeCompare(y.id));
}

/** Knockout pairs: group winners meet runners-up of another group (1A–2B, 1B–2A …), so group-mates can't meet in round 1. */
export function knockoutPairs(tables: readonly GroupRow[][]): Array<[string, string]> {
  const firsts = tables.map(t => t[0]?.id).filter(Boolean) as string[];
  const seconds = tables.map(t => t[1]?.id).filter(Boolean) as string[];
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < firsts.length; i++) {
    const opponent = seconds[(i + 1) % Math.max(1, seconds.length)];
    if (opponent && opponent !== firsts[i]) pairs.push([firsts[i], opponent]);
  }
  return pairs;
}

/** Advance a knockout round: winners in bracket order (byes for an odd count go to the first listed). */
export function advance(pairs: ReadonlyArray<[string, string]>, results: ReadonlyMap<string, Shootout>): string[] {
  return pairs.map(([a, b]) => { const ra = results.get(a), rb = results.get(b); return !ra ? b : !rb ? a : decide(ra, rb) === "a" ? a : b; });
}
export function pairUp(ids: readonly string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < ids.length; i += 2) pairs.push([ids[i], ids[i + 1]]);
  return pairs;
}
