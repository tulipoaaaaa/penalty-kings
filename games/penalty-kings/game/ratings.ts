/**
 * EARLY ACCESS: a Friend's RATING is its payout rate (RTP): the share of the ball price a ball pays back on average.
 * It depends on the Friend's generation (games/penalty-kings/config/ratings.json, editable; docs/EARLY-ACCESS.md).
 *
 * The odds are GENERATED from the rating. The rarity ladder and the prize multiples (× ball price) never change:
 *
 *   Scuffed 0× · Training 0.5× · Match 1× · Pro 1.5× · Silver 2.5× · Gold 5× · Golden Boot 10×
 *
 * METHOD (solveChances). Start from today's table, which is exactly 90.00%:
 *   3150 / 2700 / 2000 / 1100 / 700 / 250 / 100 basis points (bps; 10,000 bps = 100%).
 * For a rating r (in hundredths of a percent, 9300 = 93.00%) let d = r − 9000 and write d = 5q + rem (0 ≤ rem < 5):
 *   Match +q+rem, Pro +q, Silver +q, and Scuffed −(3q + rem) so the chances still sum to 10,000.
 * One step q adds 1× + 1.5× + 2.5× = 5 bps of return, and each `rem` bps moved from Scuffed (0×) to Match (1×) adds
 * 1 bp, so the expected return is exactly r (integer arithmetic, no rounding). A whole-percent step is q = 20: every
 * chance stays a whole multiple of 10 bps. Gold and Golden Boot are untouched, so the jackpot chance and the prize
 * bank reserve (one top prize = 10 × price per ball in flight) are the same for every rating. The ladder stays
 * monotone (each rarer ball no more likely than the one before) for 67.50% ≤ r ≤ 97.50%; outside that the solver
 * throws. Across ratings it is monotone too: a higher rating never lowers any paying chance.
 *
 * Pure module: no top-level calls (the full build tree-shakes it away completely).
 */
import ratingsJson from "../config/ratings.json" with { type: "json" };

/** Prize multiples × 10 (Training pays 0.5× = 5/10), in rarity order. */
export const MULTIPLES_X10: readonly number[] = [0, 5, 10, 15, 25, 50, 100];
/** Today's 90.00% table (games/penalty-kings/tiers/*.json): the solver's starting point. */
export const BASE_CHANCES: readonly number[] = [3150, 2700, 2000, 1100, 700, 250, 100];
export const BASE_RTP_BPS = 9000;
/** The range the solver keeps monotone (see METHOD). */
export const MIN_SOLVABLE_BPS = 6750, MAX_SOLVABLE_BPS = 9750;
export const GENERATIONS: readonly number[] = [1, 2, 3, 4, 5, 6];

export type RatingConfig = Readonly<{
  /** Rating in percent per generation (e.g. 93 or 93.5). */
  generations: Readonly<Record<string, number>>;
  bonus: Readonly<{ enabled: boolean; points: number; cosmetic: string }>;
  /** The generation the SIMULATED preview treats its Friend as (Friend #7730 is generation 3 on-chain). */
  previewGeneration: number;
}>;

/** Percent (93, 93.5, 93.25) → hundredths of a percent (9300). Null when it has more than 2 decimals. */
export function percentToBps(percent: number): number | null {
  const bps = Math.round(percent * 100);
  return Number.isFinite(percent) && Math.abs(bps - percent * 100) < 1e-6 ? bps : null;
}
export const bpsToPercent = (bps: number) => `${(bps / 100).toFixed(2)}%`;

/** Every problem with a rating config (empty = valid). Rejects ratings (and rating + bonus) ≥ 100% or < 0%. */
export function ratingConfigErrors(raw: unknown): string[] {
  const errors: string[] = [];
  const value = raw as Partial<RatingConfig> | null;
  if (!value || typeof value !== "object") return ["config must be an object"];
  const gens = value.generations;
  if (!gens || typeof gens !== "object") return ["generations must be an object of generation → rating %"];
  const bonus = value.bonus;
  if (!bonus || typeof bonus !== "object" || typeof bonus.enabled !== "boolean" || typeof bonus.points !== "number" || typeof bonus.cosmetic !== "string") errors.push("bonus must be { enabled: boolean, points: number, cosmetic: string }");
  const bonusBps = bonus && typeof bonus.points === "number" ? percentToBps(bonus.points) : null;
  if (bonus && typeof bonus.points === "number") {
    if (!(bonus.points >= 0)) errors.push(`bonus.points must be ≥ 0 (got ${bonus.points})`);
    else if (bonusBps === null) errors.push(`bonus.points must have at most 2 decimals (got ${bonus.points})`);
    if (typeof bonus.cosmetic === "string" && !bonus.cosmetic.trim()) errors.push("bonus.cosmetic must name a cosmetic");
  }
  for (const generation of GENERATIONS) if (!(String(generation) in gens)) errors.push(`generation ${generation} is missing`);
  for (const [key, percent] of Object.entries(gens)) {
    if (!/^[1-9]\d*$/.test(key)) { errors.push(`"${key}" is not a generation number`); continue; }
    if (typeof percent !== "number" || !Number.isFinite(percent)) { errors.push(`gen-${key}: rating must be a number`); continue; }
    if (percent < 0) { errors.push(`gen-${key}: rating ${percent}% is below 0%`); continue; }
    if (percent >= 100) { errors.push(`gen-${key}: rating ${percent}% must be below 100%`); continue; }
    const bps = percentToBps(percent);
    if (bps === null) { errors.push(`gen-${key}: rating ${percent}% has more than 2 decimals`); continue; }
    if (bps < MIN_SOLVABLE_BPS || bps > MAX_SOLVABLE_BPS) errors.push(`gen-${key}: rating ${percent}% is outside ${bpsToPercent(MIN_SOLVABLE_BPS)}–${bpsToPercent(MAX_SOLVABLE_BPS)}, where the rarity ladder can stay monotone`);
    if (bonusBps !== null && bonusBps > 0) {
      const total = bps + bonusBps;
      if (total >= 10000) errors.push(`gen-${key}: rating ${percent}% + bonus ${bonus!.points} points = ${bpsToPercent(total)} must be below 100%`);
      else if (total > MAX_SOLVABLE_BPS) errors.push(`gen-${key}: rating + bonus ${bpsToPercent(total)} is above ${bpsToPercent(MAX_SOLVABLE_BPS)}, where the rarity ladder can stay monotone`);
    }
  }
  if (typeof value.previewGeneration !== "number" || !(String(value.previewGeneration) in gens)) errors.push("previewGeneration must be one of the listed generations");
  return errors;
}

/** The validated config (throws with every problem listed). */
export function parseRatingConfig(raw: unknown): RatingConfig {
  const errors = ratingConfigErrors(raw);
  if (errors.length) throw new Error(`Invalid ratings config:\n- ${errors.join("\n- ")}`);
  return raw as RatingConfig;
}

/** The shipped config (config/ratings.json), validated. */
export const ratingConfig = (): RatingConfig => parseRatingConfig(ratingsJson);

/** A generation's payout rate in bps, plus the cosmetic bonus when it applies. Null for an unrated generation. */
export function payoutBps(config: RatingConfig, generation: number, withBonus = false): number | null {
  const percent = config.generations[String(generation)];
  if (typeof percent !== "number") return null;
  const base = percentToBps(percent)!;
  return withBonus && config.bonus.enabled ? base + percentToBps(config.bonus.points)! : base;
}

/** True when the named bonus cosmetic applies (the bonus is enabled and the player owns or equips it). */
export const bonusApplies = (config: RatingConfig, ownedCosmeticNames: readonly string[]) => config.bonus.enabled && config.bonus.points > 0 && ownedCosmeticNames.includes(config.bonus.cosmetic);

/** The chance table (bps, rarity order) whose expected return is exactly `rtpBps` (see METHOD). */
export function solveChances(rtpBps: number): number[] {
  if (!Number.isInteger(rtpBps)) throw new Error(`rating must be whole basis points of a percent (got ${rtpBps})`);
  if (rtpBps < MIN_SOLVABLE_BPS || rtpBps > MAX_SOLVABLE_BPS) throw new Error(`rating ${bpsToPercent(rtpBps)} is outside ${bpsToPercent(MIN_SOLVABLE_BPS)}–${bpsToPercent(MAX_SOLVABLE_BPS)}`);
  const d = rtpBps - BASE_RTP_BPS, q = Math.floor(d / 5), rem = d - 5 * q;
  const [scuffed, training, match, pro, silver, gold, boot] = BASE_CHANCES;
  const chances = [scuffed - 3 * q - rem, training, match + q + rem, pro + q, silver + q, gold, boot];
  const problems = chanceTableErrors(chances, rtpBps);
  if (problems.length) throw new Error(`solveChances(${rtpBps}): ${problems.join("; ")}`);
  return chances;
}

/** Expected return of a chance table in bps × 10 (exact integer): Σ chance × multiple×10. Equals 10 × rtpBps. */
export const expectedReturnX10 = (chances: readonly number[]) => chances.reduce((sum, chance, index) => sum + chance * MULTIPLES_X10[index], 0);
/** Exact expected return in bps of a percent (9300 = 93.00%), or NaN when it is not a whole bp. */
export const expectedReturnBps = (chances: readonly number[]) => { const x10 = expectedReturnX10(chances); return x10 % 10 === 0 ? x10 / 10 : Number.NaN; };

/** Everything a published table must satisfy: integer bps, sum exactly 10,000, monotone, exact rating. */
export function chanceTableErrors(chances: readonly number[], rtpBps: number): string[] {
  const errors: string[] = [];
  if (chances.length !== MULTIPLES_X10.length) errors.push(`${chances.length} outcomes (want ${MULTIPLES_X10.length})`);
  if (chances.some(chance => !Number.isInteger(chance) || chance < 0)) errors.push("every chance must be a whole, non-negative number of bps");
  const sum = chances.reduce((a, b) => a + b, 0);
  if (sum !== 10000) errors.push(`chances sum to ${sum} bps (want 10000)`);
  for (let i = 1; i < chances.length; i++) if (chances[i] > chances[i - 1]) errors.push(`not monotone: rarity ${i} (${chances[i]}) > rarity ${i - 1} (${chances[i - 1]})`);
  if (expectedReturnX10(chances) !== rtpBps * 10) errors.push(`expected return ${expectedReturnX10(chances) / 10} bps (want ${rtpBps})`);
  return errors;
}

/** Per-ball maximum payout and the prize bank reserve (one top prize per ball in flight), in multiples of the price. */
export function bankFigures(chances: readonly number[]) {
  const top = Math.max(...MULTIPLES_X10.filter((_, index) => chances[index] > 0)) / 10;
  return { maxPayoutX: top, reserveX: top };
}

/** Ball stats from the definition the build rolls with: its rating (bps) and the generations that rating belongs to. */
export function ratingOfTable(config: RatingConfig, chances: readonly number[]) {
  const rtp = expectedReturnBps(chances);
  const generations = GENERATIONS.filter(generation => payoutBps(config, generation) === rtp);
  return { rtpBps: rtp, generations, bonus: !generations.length && GENERATIONS.some(generation => payoutBps(config, generation, true) === rtp) };
}

export type ChanceGameJson = { name: string; consumable: string; price: string; outcomes: { name: string; chanceBps: number; reward: string }[] };

/** The reviewable ChanceGame JSON for one rating: the base stadium definition with generated chances. */
export function ratedDefinition(base: ChanceGameJson, label: string, rtpBps: number): ChanceGameJson {
  const chances = solveChances(rtpBps);
  return { name: `${base.name} · ${label} (${bpsToPercent(rtpBps)})`, consumable: base.consumable, price: base.price, outcomes: base.outcomes.map((outcome, index) => ({ name: outcome.name, chanceBps: chances[index], reward: outcome.reward })) };
}

/** Which rated definitions exist per stadium: one per generation, plus one per generation with the bonus when it is enabled. */
export function ratedVariants(config: RatingConfig): { file: string; label: string; rtpBps: number; generation: number; bonus: boolean }[] {
  const variants = GENERATIONS.map(generation => ({ file: `gen-${generation}`, label: `Gen ${generation}`, rtpBps: payoutBps(config, generation)!, generation, bonus: false }));
  if (config.bonus.enabled && config.bonus.points > 0) for (const generation of GENERATIONS) variants.push({ file: `gen-${generation}-bonus`, label: `Gen ${generation} + ${config.bonus.cosmetic}`, rtpBps: payoutBps(config, generation, true)!, generation, bonus: true });
  return variants;
}
