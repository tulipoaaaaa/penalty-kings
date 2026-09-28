/**
 * The founder-shaped ball flow: SHOP → PACK OPENING → BAG → CHOOSE → KICK, plus the Collection
 * (editions × rarities) and a clearly labelled "Market (coming soon)" preview.
 * Honesty: rarity is decided by on-chain randomness at reveal; ball choice only affects the kick.
 */
import { useState, type ReactNode } from "react";
import type { ChanceGameDefinition } from "@rarefriends/friendsdk/game";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import { TIERS, formatNumber, type Tier, type TierId } from "./economy.js";
import { STADIUM_RACE_RULE, stadiumRaceLine } from "./game/weekly.js";
import { RARITY_NAMES } from "./gfx/stage.js";
import { BallCase, BallSpin, ballGlow, TokenExplainer, RarityChip, Tile } from "./ui.js";
import { oddsLabel } from "./game/ratings.js";
import { SEASONS, BALL_PROMISE, CHOICE_RULE, editionLabel, isDiscontinued, packSummary, sortBag, type BallRecord, type SortKey } from "./game/bag.js";

const rf = (value: bigint) => `${formatGameAmount(value, 18)} RF`;
const PACKS = [1n, 2n, 5n, 10n] as const;
/** Scuffed explained (round 6 C10): shown before the first purchase and in any pack summary with a Scuffed ball. */
export const SCUFFED_LINE = "0 RF, but still drops $GBOOT and counts for your collection";

/** The odds printed on every pack (D21): each rarity and its exact chance, straight from the game definition. */
export function OddsLine({ definition, onFull }: { definition: ChanceGameDefinition; onFull?: () => void }) {
  return <p className="pk-oddsline" data-testid="odds-line">{globalThis.PK_EARLY_ACCESS ? <b>{oddsLabel(definition.outcomes.map(item => item.chanceBps))}</b> : <b>Odds per ball:</b>} {definition.outcomes.map((item, index) =>
    <span key={item.name}><RarityChip rarity={index} /><span className="pk-oname">{RARITY_NAMES[index].replace(" Ball", "")} </span>{item.chanceBps / 100}%</span>)}
    {onFull && <button type="button" className="pk-link pk-fullodds" onClick={onFull} data-testid="full-odds">Full odds ›</button>}</p>;
}

/** B5: the pack while the Stage reveals it ("stage": a compact card strip under the reveal) and after ("summary"). */
export type PackPhase = "tear" | "flip" | "summary";

/**
 * a) SHOP (owner decision b): the display case leads (every ball a pack can pull, with its odds and RF value), then
 * the Buy bar (pack size, "Buy pack · price", Open unopened) above the fold at every frame size. Below it: the true
 * figures (total cost, top prize, the odds line, the 90% average return), the first-purchase explainer and the stadiums.
 * Spending is confirmed by the wallet (the SDK's confirmation dialog) before anything is charged.
 */
export function Shop({ definition, tier, simulated, balance, busy, full, onBuy, onOdds, unopened, onOpen, firstPurchase = false, now = Date.now(), onStadium, notice }: {
  definition: ChanceGameDefinition; tier: Tier; simulated: boolean; balance: bigint; busy: boolean; full: boolean;
  onBuy: (quantity: bigint) => void; onOdds: () => void; unopened: bigint; onOpen: () => void; firstPurchase?: boolean;
  /** C3b: the stadium clock (Champions Night doubles the Cup points line) and "Play at <stadium>" (opens that stadium's own page). */
  now?: number; onStadium?: (id: TierId) => void;
  /** The last shop message ("2 balls bought…", an error), shown right under the Buy bar. */
  notice?: ReactNode;
}) {
  const affordable = PACKS.filter(size => balance >= definition.price * size);
  const [pack, setPack] = useState<bigint>(affordable.includes(5n) ? 5n : affordable[affordable.length - 1] ?? 1n);
  const tag = simulated ? " (sim)" : "";
  const cost = definition.price * pack, maxPrize = definition.outcomes.reduce((max, item) => (item.reward > max ? item.reward : max), 0n);
  return <div className="pk-shop">
    <BallCase definition={definition} tag={tag} simulated={simulated} stadium={tier.name} />
    <div className="pk-buybar" data-testid="buy-bar">
      <div className="pk-packs" role="radiogroup" aria-label="Pack size">
        {PACKS.map(size => <button key={size.toString()} type="button" role="radio" aria-checked={pack === size} onClick={() => setPack(size)} data-testid={`pack-${size}`} disabled={balance < definition.price * size} title={balance < definition.price * size ? "Not enough RF for this pack" : undefined}>
          {size.toString()} ball{size > 1n ? "s" : ""}</button>)}
      </div>
      {full ? <p className="pk-warn" role="status">Stadium full: every seat's top prize is reserved right now. Try again after some balls settle.</p>
        : <div className="pk-buyrow">
          <button type="button" className="pk-primary" disabled={busy || balance < cost} onClick={() => onBuy(pack)} data-testid="buy-pack">Buy pack · {rf(cost)}{tag}</button>
          {unopened > 0n && <button type="button" onClick={onOpen} data-testid="open-pack">Open {unopened.toString()} unopened</button>}
        </div>}
    </div>
    <div className="pk-avgline">
      <p className="pk-note">Average return 90% of the ball price in RF, over many balls. Most packs return less than they cost; a few return much more.</p>
      <button type="button" onClick={onOdds}>See odds</button>
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
      <p>Each ball's rarity is decided when you open the pack, and every ball is worth the RF printed on it. <button type="button" className="pk-link" onClick={onOdds}>See odds</button></p>
      <p><b>{RARITY_NAMES[0]}:</b> {SCUFFED_LINE}.</p>
      <TokenExplainer />
    </div>}
    <h3>Stadiums</h3>
    <div className="pk-tiers" role="radiogroup" aria-label="Stadium">
      {TIERS.map(item => <div key={item.id} className="pk-tiercard" data-stadium={item.id} data-current={item.id === tier.id} role="radio" aria-checked={item.id === tier.id}>
        <strong>{item.name}</strong>
        <span className="pk-tierprice"><b>{item.priceRF.toLocaleString("en-US")} RF</b> per ball</span>
        <small>top prize {(item.priceRF * 10).toLocaleString("en-US")} RF</small>
        <small className="pk-tierrace" data-testid={`race-${item.id}`}>{stadiumRaceLine(item, now, simulated)}</small>
        {item.id === tier.id ? <small className="pk-tierwhere">You are here</small>
          : <button type="button" className="pk-tiergo" data-testid={`go-${item.id}`} onClick={() => onStadium?.(item.id)} disabled={!onStadium}>
            Play at {item.name} ›<small>{item.id === "park" ? "main page" : `/${item.id}/`}{simulated ? " · SIMULATED" : " · LIVE"}</small></button>}
      </div>)}
    </div>
    <p className="pk-note" data-testid="stadium-rule">{STADIUM_RACE_RULE}</p>
  </div>;
}

/** b) PACK OPENING: face-down cards, tap to flip (each flip plays the true reveal), or reveal all; then a TRUE summary. */
export function PackOpening({ rarities, revealed, definition, simulated, gboot, phase, onOdds, onFlip, onRevealAll, onDone }: {
  rarities: readonly number[]; revealed: readonly boolean[]; definition: ChanceGameDefinition; simulated: boolean; gboot: number;
  phase: PackPhase; onOdds: () => void; onFlip: (index: number) => void; onRevealAll: () => void; onDone: () => void;
}) {
  const done = revealed.every(Boolean), summaryShown = done && phase === "summary";
  const rewardOf = (rarity: number) => definition.outcomes[rarity].reward;
  const summary = packSummary(rarities, definition.price, rewardOf);
  const scuffed = rarities.filter(rarity => rarity === 0).length;
  const tag = simulated ? " (sim)" : "";
  // B5 (BQ-X2): while the Stage reveals, the panel is a compact strip under the reveal's banner, so the canvas owns the moment.
  // BQ-X3: the odds + honesty strip sits OUTSIDE the scroll area, so the summary can never scroll it away.
  return <div className="pk-pack" data-phase={summaryShown ? "summary" : "stage"} role="dialog" aria-label="Pack opening" data-testid="pack">
    <div className="pk-pack-strip">
      <OddsLine definition={definition} onFull={onOdds} />
      <p className="pk-honest">Rarity decided by {simulated ? "the preview's simulated draw (on-chain randomness when live)" : "on-chain randomness (Dice)"} when the pack was opened. Tapping order and speed change nothing.</p>
    </div>
    <div className="pk-pack-body">
    <div className="pk-cards">{rarities.map((rarity, index) => <button key={index} type="button" className="pk-card" data-revealed={revealed[index]} data-rarity={revealed[index] ? rarity : undefined} disabled={revealed[index]} onClick={() => onFlip(index)} aria-label={revealed[index] ? RARITY_NAMES[rarity] : `Ball ${index + 1}: tap to reveal`}
      style={revealed[index] ? { backgroundImage: ballGlow(rarity) } : { backgroundImage: "repeating-linear-gradient(45deg, #ffffff0d 0 4px, transparent 4px 8px), linear-gradient(135deg, #2a3160, #151a33)" }}>
      {revealed[index] ? <><BallSpin rarity={rarity} size={summaryShown ? 36 : 24} /><strong>{RARITY_NAMES[rarity].replace(" Ball", "")}</strong><small>{rf(rewardOf(rarity))}</small></> : <span className="pk-cardback">?</span>}
    </button>)}</div>
    {!done && <button type="button" className="pk-primary" onClick={onRevealAll} data-testid="reveal-all">Reveal all</button>}
    {summaryShown && <div className="pk-summary" data-testid="pack-summary">
      <h3>Pack summary</h3>
      <p>Spent <b>{rf(summary.spent)}</b>{tag} on {summary.count} ball{summary.count === 1 ? "" : "s"}. Together they are worth <b>{rf(summary.pulled)}</b>{tag}{summary.pulled > 0n ? ": they are yours, and you can cash any of them back into RF from your Bag at any time." : "."}</p>
      <p>Difference: <b className={summary.net < 0n ? "pk-loss" : "pk-gain"}>{summary.net < 0n ? "−" : "+"}{rf(summary.net < 0n ? -summary.net : summary.net)}</b>{tag}. {summary.net < 0n ? "Most packs return less than they cost; a few return much more." : summary.net > 0n ? "This pack is worth more than it cost; most packs return less." : "This pack is worth exactly what it cost."}</p>
      {globalThis.PK_EARLY_ACCESS ? <p>Best ball: {summary.best >= 0 ? RARITY_NAMES[summary.best] : "none"}.</p> : <p>$GBOOT dropped: +{formatNumber(gboot)}{simulated ? " (simulated)" : " (paid weekly)"}. Best ball: {summary.best >= 0 ? RARITY_NAMES[summary.best] : "none"}.</p>}
      {scuffed > 0 && <p data-testid="scuffed-note"><b>{scuffed} {RARITY_NAMES[0]}{scuffed === 1 ? "" : "s"}:</b> {globalThis.PK_EARLY_ACCESS ? "0 RF, but it counts for your collection" : SCUFFED_LINE}.</p>}
      <button type="button" className="pk-primary" onClick={onDone} autoFocus data-testid="to-bag">Go to my Bag</button>
    </div>}
    </div>
  </div>;
}

/** c) BAG: grouped by rarity with counts; per-ball edition, value, career; Shoot / Redeem / Keep; sort; Collection view. */
export function Bag({ records, definition, simulated, busy, selected, onShoot, onRedeem, onLucky, onMarket }: {
  records: readonly BallRecord[]; definition: ChanceGameDefinition; simulated: boolean; busy: boolean; selected: string | null;
  onShoot: (record: BallRecord) => void; onRedeem: (record: BallRecord) => void; onLucky: (record: BallRecord) => void; onMarket: () => void;
}) {
  const [sort, setSort] = useState<SortKey>("rarity");
  const [view, setView] = useState<"bag" | "collection">("bag");
  const rewardOf = (rarity: number) => definition.outcomes[rarity].reward;
  const real = records.filter(record => !record.sample);
  const sorted = sortBag(real, sort, rewardOf);
  const tag = simulated ? " (sim)" : "";
  return <div className="pk-bag" data-testid="bag">
    <div className="pk-buyrow">
      <button type="button" aria-pressed={view === "bag"} onClick={() => setView("bag")}>Bag ({real.length})</button>
      <button type="button" aria-pressed={view === "collection"} onClick={() => setView("collection")}>Collection</button>
      {globalThis.PK_EARLY_ACCESS ? null : <button type="button" onClick={onMarket}>Market (coming soon)</button>}
      {view === "bag" && <label>Sort <select value={sort} onChange={event => setSort(event.target.value as SortKey)}><option value="rarity">rarity</option><option value="value">value</option><option value="newest">newest</option></select></label>}
    </div>
    <p className="pk-note">{BALL_PROMISE}</p>
    {view === "bag" && (real.length === 0 ? <p>Your Bag is empty. Buy a pack in the Ball shop.</p>
      : <>
        <p className="pk-counts">{RARITY_NAMES.slice(0, 7).map((name, rarity) => { const n = real.filter(r => r.rarity === rarity).length; return n ? <span key={name} data-rarity={rarity}><RarityChip rarity={rarity} />{name.replace(" Ball", "")} ×{n}</span> : null; })}</p>
        <div className="pk-bagrid">{sorted.map(record => <div key={record.id} className="pk-ballcard" data-rarity={record.rarity} data-selected={selected === record.id} data-testid="ball">
          <BallSpin rarity={record.rarity} size={40} season={record.season} />
          <strong>{RARITY_NAMES[record.rarity]}{record.lucky ? " ★" : ""}</strong>
          <small className="pk-stamp">{editionLabel(record)}{isDiscontinued(record.season) ? " · DISCONTINUED" : ""}</small>
          <small>{rf(rewardOf(record.rarity))}{tag} · kicked {record.kicks}× · {record.goals} goals{record.topBins ? ` · ${record.topBins} top bins` : ""}{record.goals >= 10 ? " · Veteran" : ""}</small>
          <div className="pk-ballactions">
            <button type="button" onClick={() => onShoot(record)} data-testid="shoot-ball">Shoot</button>
            <button type="button" disabled={busy || rewardOf(record.rarity) === 0n} onClick={() => onRedeem(record)} data-testid="redeem-ball" title={rewardOf(record.rarity) === 0n ? "Scuffed balls have no RF value" : undefined}>Redeem {rf(rewardOf(record.rarity))}</button>
            <button type="button" aria-pressed={record.lucky} onClick={() => onLucky(record)} title="Star one lucky ball">{record.lucky ? "★ Lucky" : "☆ Lucky"}</button>
          </div>
        </div>)}</div>
      </>)}
    {view === "collection" && <Collection records={records} simulated={simulated} />}
    <p className="pk-note">{CHOICE_RULE}</p>
  </div>;
}

/** Editions × rarities; discontinued seasons stay redeemable forever. */
function Collection({ records, simulated }: { records: readonly BallRecord[]; simulated: boolean }) {
  const seasons = SEASONS.filter(season => !season.sample || simulated);
  return <table className="pk-collection"><thead><tr><th>Edition</th>{RARITY_NAMES.slice(0, 7).map(name => <th key={name}>{name.replace(" Ball", "")}</th>)}</tr></thead>
    <tbody>{seasons.map(season => <tr key={season.id}>
      <td><b>{season.name}</b><br /><small>{season.active ? "active" : "DISCONTINUED · still redeemable"}{season.sample ? " · sample (simulated)" : ""}</small></td>
      {RARITY_NAMES.slice(0, 7).map((name, rarity) => { const n = records.filter(r => r.season === season.id && r.rarity === rarity).length;
        return <td key={name} data-owned={n > 0}>{n ? <><BallSpin rarity={rarity} size={22} season={season.id} spinning={false} /> ×{n}</> : "·"}</td>; })}
    </tr>)}</tbody></table>;
}

/** d) CHOOSE: a carousel of the Bag before each Big Match kick. "Kick with this ball" kicks the ball SHOWN (the first one when nothing is selected, e.g. after redeeming the selected ball: BQ-P1-6). */
export function BallCarousel({ records, selected, onSelect, onKick, onClose }: {
  records: readonly BallRecord[]; selected: string | null; onSelect: (id: string) => void; onKick: (id: string) => void; onClose: () => void;
}) {
  const real = records.filter(record => !record.sample);
  const index = Math.max(0, real.findIndex(record => record.id === selected)), current = real[index];
  const step = (delta: number) => { if (real.length) onSelect(real[(index + delta + real.length) % real.length].id); };
  return <div className="pk-carousel" role="dialog" aria-label="Choose a ball" data-testid="carousel">
    <button type="button" onClick={() => step(-1)} aria-label="Previous ball">‹</button>
    {current ? <div className="pk-carouselball">
      <BallSpin rarity={current.rarity} size={48} season={current.season} />
      <strong>{RARITY_NAMES[current.rarity]}{current.lucky ? " ★ lucky" : ""}</strong>
      <small>{editionLabel(current)} · {current.goals} goals in {current.kicks} kicks</small>
    </div> : <p>No balls in your Bag.</p>}
    <button type="button" onClick={() => step(1)} aria-label="Next ball">›</button>
    <div className="pk-carouselactions">
      <button type="button" className="pk-primary" disabled={!current} onClick={() => { if (current) onKick(current.id); }} data-testid="kick-with-ball">Kick with this ball</button>
      <button type="button" onClick={onClose}>Close</button>
    </div>
    <p className="pk-note">{CHOICE_RULE}</p>
  </div>;
}

/** 4) Market (coming soon): a labelled preview of the v2 Ball Market (docs/BALL-MARKET.md). */
export function MarketPreview() {
  const listings = [
    { name: "Golden Boot Ball", edition: "S0 · Park · DISCONTINUED", floor: 100, ask: 180, note: "discontinued edition premium" },
    { name: "Gold Ball", edition: "S1 · Park", floor: 50, ask: 57, note: "near floor" },
    { name: "Silver Ball", edition: "S0 · Park · DISCONTINUED", floor: 25, ask: 34, note: "collector premium" },
  ];
  return <div className="pk-market">
    <p><b>Market: coming soon (v2 design, not deployed).</b> Balls are bound to your Friend today. The v2 BallVault would let you redeem a ball into a transferable "Vault Ball" backed 1:1 by its RF value. Unwrap it any time for that RF, or list it above its floor.</p>
    <table className="pk-odds"><thead><tr><th>Sample listing (simulated)</th><th>Edition</th><th>Floor (RF backing)</th><th>Ask</th></tr></thead>
      <tbody>{listings.map(item => <tr key={item.name + item.edition}><td>{item.name}</td><td>{item.edition}</td><td>{item.floor} RF</td><td>{item.ask} RF <small>({item.note})</small></td></tr>)}</tbody></table>
    <p className="pk-note">Every figure in this table is a SIMULATED example. No market exists yet, and nothing here can be bought.</p>
  </div>;
}
