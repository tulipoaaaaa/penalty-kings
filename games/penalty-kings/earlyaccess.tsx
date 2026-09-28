/**
 * EARLY ACCESS screens (game/features.ts): the Ball shop and the odds with the player's per-Friend RATING (payout
 * rate by Friend generation, game/ratings.ts). Used only from early access regions (scripts/lib/ea-regions.mjs), so
 * the full build never includes it. Styles reuse the game's own classes (style.css is shared with the full build and
 * stays untouched); the few extras are inline.
 *
 * Where the rating comes from:
 *  - the odds the stadium ROLLS with are its ChanceGame definition (`definition`): the rating is computed from it,
 *    exactly, so the number on screen can never disagree with the roll;
 *  - the player's generation: in the SIMULATED preview, config/ratings.json `previewGeneration` (the preview Friend,
 *    #7730, is generation 3 on-chain). A live build needs the platform to supply it (docs/EARLY-ACCESS.md); until then
 *    it is unknown and buying is off. If the two ever disagree, buying is off too.
 */
import { useState, type ReactNode } from "react";
import type { ChanceGameDefinition } from "@rarefriends/friendsdk/game";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import { TIERS, type Tier, type TierId } from "./economy.js";
import { RARITY_NAMES } from "./gfx/stage.js";
import { BallCase, RarityChip, Tile } from "./ui.js";
import { OddsLine } from "./ballui.js";
import { ratingConfig, ratingOfTable, payoutBps, bpsToPercent, GENERATIONS, type RatingConfig } from "./game/ratings.js";

const rf = (value: bigint) => `${formatGameAmount(value, 18)} RF`;
const PACKS = [1n, 2n, 5n, 10n] as const;

export type PlayerRating = Readonly<{
  config: RatingConfig;
  /** The stadium's rolled odds: exact payout rate (bps) and the generations it belongs to. */
  table: ReturnType<typeof ratingOfTable>;
  /** The player's Friend generation (null: unknown), and whether it is simulated. */
  generation: number | null; simulatedGeneration: boolean;
  /** The player's own rating (bps) or null. */
  rtpBps: number | null;
  /** True when the stadium's odds are the player's own: buying is allowed. */
  matches: boolean;
}>;

/** The player's rating at this stadium (see the header for where each part comes from). */
export function playerRating(definition: ChanceGameDefinition, simulated: boolean): PlayerRating {
  const config = ratingConfig();
  const table = ratingOfTable(config, definition.outcomes.map(outcome => outcome.chanceBps));
  const generation = simulated ? config.previewGeneration : null;
  const rtpBps = generation === null ? null : payoutBps(config, generation);
  return { config, table, generation, simulatedGeneration: simulated, rtpBps, matches: rtpBps !== null && rtpBps === table.rtpBps };
}

export const ratingText = (rating: PlayerRating) => bpsToPercent(rating.table.rtpBps);

/** "Your Friend: Gen 3 · rating 93.00%", the generation table, the bonus line, and why buying is off (if it is). */
export function RatingPanel({ rating }: { rating: PlayerRating }) {
  const { config, generation } = rating;
  return <section className="pk-explain" data-testid="rating-panel" aria-label="Your Friend's rating">
    <h3 style={{ margin: "0 0 4px" }}>Your rating: <b data-testid="rating-value">{rating.rtpBps === null ? "unknown" : bpsToPercent(rating.rtpBps)}</b> payout</h3>
    <p style={{ margin: "0 0 4px" }} data-testid="rating-friend">
      {generation === null ? "Your Friend's generation is not available in this build, so buying is off."
        : <>Your Friend is <b>Gen {generation}</b>{rating.simulatedGeneration ? <> (<b className="pk-simtag">SIMULATED</b>: this preview plays as Gen {generation}, the on-chain generation of the preview Friend #7730)</> : null}. A ball pays back {bpsToPercent(rating.rtpBps!)} of its price on average, over many balls.</>}
    </p>
    <table className="pk-odds" data-testid="rating-table"><thead><tr><th>Friend generation</th>{GENERATIONS.map(gen => <th key={gen}>Gen {gen}</th>)}</tr></thead>
      <tbody><tr><td>Rating (payout rate)</td>{GENERATIONS.map(gen => <td key={gen} data-mine={gen === generation || undefined} style={gen === generation ? { fontWeight: 700, textDecoration: "underline" } : undefined}>{bpsToPercent(payoutBps(config, gen)!)}</td>)}</tr></tbody></table>
    {config.bonus.enabled && config.bonus.points > 0 && <p className="pk-note" data-testid="rating-bonus">{config.bonus.cosmetic} bonus: +{config.bonus.points} percentage points while your Friend owns it (not owned).</p>}
    {!rating.matches && generation !== null && <p className="pk-warn" role="status" data-testid="rating-mismatch">This stadium rolls at {bpsToPercent(rating.table.rtpBps)}, not your rating, so buying is off here.</p>}
    <p className="pk-note">Same balls and prizes for everyone; a higher rating makes the paying balls a little more likely. Rarity is still decided by randomness, never by your kick.</p>
  </section>;
}

/** The exact odds for the player's own rating: chance and RF value per ball (no $GBOOT in early access). */
export function RatingOddsTable({ definition, tag, rating }: { definition: ChanceGameDefinition; tag: string; rating: PlayerRating }) {
  const text = ratingText(rating);
  return <>
    <table className="pk-odds pk-oddstable" data-testid="rating-odds"><thead><tr><th>Ball</th><th>Chance</th><th>RF value</th></tr></thead>
      <tbody>{definition.outcomes.map((item, index) => <tr key={item.name} data-rarity={index}>
        <td><span className="pk-rname"><RarityChip rarity={index} />{RARITY_NAMES[index]}</span></td><td>{(item.chanceBps / 100).toFixed(2)}%</td><td>{formatGameAmount(item.reward, 18)}{tag}</td></tr>)}</tbody></table>
    <div className="pk-callout">
      <Tile value={text} label="your payout rate" tone="volt" />
      <p><b>Average return: {text}</b> of the ball price in RF, over many balls (your Friend's rating). Individual results vary: most balls return less than they cost, a few return much more. The kick never changes which ball you get.</p>
    </div>
  </>;
}

/** The Ball shop in early access: rating first, then the display case, the Buy bar and the true figures. No $GBOOT, no Cup race. */
export function EarlyAccessShop({ definition, tier, simulated, balance, busy, full, onBuy, onOdds, unopened, onOpen, firstPurchase = false, onStadium, notice }: {
  definition: ChanceGameDefinition; tier: Tier; simulated: boolean; balance: bigint; busy: boolean; full: boolean;
  onBuy: (quantity: bigint) => void; onOdds: () => void; unopened: bigint; onOpen: () => void; firstPurchase?: boolean;
  onStadium?: (id: TierId) => void; notice?: ReactNode;
}) {
  const rating = playerRating(definition, simulated);
  const affordable = PACKS.filter(size => balance >= definition.price * size);
  const [pack, setPack] = useState<bigint>(affordable.includes(5n) ? 5n : affordable[affordable.length - 1] ?? 1n);
  const tag = simulated ? " (sim)" : "";
  const cost = definition.price * pack, maxPrize = definition.outcomes.reduce((max, item) => (item.reward > max ? item.reward : max), 0n);
  return <div className="pk-shop" data-testid="ea-shop">
    <RatingPanel rating={rating} />
    <BallCase definition={definition} tag={tag} simulated={simulated} stadium={`${tier.name} · rating ${ratingText(rating)}`} />
    <div className="pk-buybar" data-testid="buy-bar">
      <div className="pk-packs" role="radiogroup" aria-label="Pack size">
        {PACKS.map(size => <button key={size.toString()} type="button" role="radio" aria-checked={pack === size} onClick={() => setPack(size)} data-testid={`pack-${size}`} disabled={balance < definition.price * size} title={balance < definition.price * size ? "Not enough RF for this pack" : undefined}>
          {size.toString()} ball{size > 1n ? "s" : ""}</button>)}
      </div>
      {full ? <p className="pk-warn" role="status">Stadium full: every seat's top prize is reserved right now. Try again after some balls settle.</p>
        : <div className="pk-buyrow">
          <button type="button" className="pk-primary" disabled={busy || balance < cost || !rating.matches} onClick={() => onBuy(pack)} data-testid="buy-pack">Buy pack · {rf(cost)}{tag}</button>
          {unopened > 0n && <button type="button" onClick={onOpen} data-testid="open-pack">Open {unopened.toString()} unopened</button>}
        </div>}
    </div>
    <div className="pk-avgline">
      <p className="pk-note">Average return {ratingText(rating)} of the ball price in RF (your rating), over many balls. Most packs return less than they cost; a few return much more.</p>
      <button type="button" onClick={onOdds} data-testid="see-odds">See odds</button>
    </div>
    {notice}
    {balance < cost && <p>{simulated ? `The preview wallet holds ${rf(balance)} of simulated RF. Redeem balls in your Bag to get RF back.` : "Not enough RF in your Friend's wallet: use Transfer RF to Friend in the wallet menu."}</p>}
    <OddsLine definition={definition} />
    <div className="pk-tiles pk-cost">
      <Tile value={<>{rf(cost)}<small>{tag}</small></>} label={`total for ${pack.toString()} ball${pack > 1n ? "s" : ""}`} tone="volt" />
      <Tile value={<>{rf(maxPrize)}<small>{tag}</small></>} label="each ball can pull up to" tone="gold" />
    </div>
    {firstPurchase && <div className="pk-explain" data-testid="first-purchase">
      <h3>Before your first pack</h3>
      <p>Each ball's rarity is decided when you open the pack, and every ball is worth the RF printed on it. You can cash any ball back into RF from your Bag. <button type="button" className="pk-link" onClick={onOdds}>See odds</button></p>
      <p><b>{RARITY_NAMES[0]}:</b> 0 RF, but it counts for your collection and you can still kick with it.</p>
    </div>}
    <h3>Stadiums</h3>
    <div className="pk-tiers" role="radiogroup" aria-label="Stadium">
      {TIERS.map(item => <div key={item.id} className="pk-tiercard" data-stadium={item.id} data-current={item.id === tier.id} role="radio" aria-checked={item.id === tier.id}>
        <strong>{item.name}</strong>
        <span className="pk-tierprice"><b>{item.priceRF.toLocaleString("en-US")} RF</b> per ball</span>
        <small>top prize {(item.priceRF * 10).toLocaleString("en-US")} RF</small>
        {item.id === tier.id ? <small className="pk-tierwhere">You are here</small>
          : <button type="button" className="pk-tiergo" data-testid={`go-${item.id}`} onClick={() => onStadium?.(item.id)} disabled={!onStadium}>
            Play at {item.name} ›<small>{item.id === "park" ? "main page" : `/${item.id}/`}{simulated ? " · SIMULATED" : " · LIVE"}</small></button>}
      </div>)}
    </div>
    <p className="pk-note">Your rating is the same at every stadium: only the ball price changes.</p>
  </div>;
}
