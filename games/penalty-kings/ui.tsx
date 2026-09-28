/** Screens and widgets for the game shell (all state lives in index.tsx). */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import type { ChanceGameDefinition as GameDefinition } from "@rarefriends/friendsdk/game";
import { KEEPERS, keeperById, DIFFICULTY_LADDER, ZONE_MULT, POST_IN_BONUS, streakMultiplier, type KeeperId } from "@penalty-kings/engine";
import { RARITIES, TIERS, TOKEN_LINES, formatNumber, type Tier } from "./economy.js";
import { drawBallSprite, drawBallShadow, ballReducedMotion, BALL_FRAMES, BALL_IDENTITY } from "./gfx/ball.js";
import { drawKeeper } from "./gfx/keepers.js";
import { RARITY_NAMES } from "./gfx/stage.js";
import { MODES, isUnlocked, levelFromXp, totalStars, LADDER, type Progress, type ModeId } from "./game/progress.js";
import { CITIES, LEVELS_PER_CITY, cityLevels, cityOpen, cityStars, nextLevel, starsToOpen } from "./game/tour.js";
import { describe, type Level } from "./game/objectives.js";
import { prizeLine, type PrizeSource } from "./game/prizes.js";
import { NO_PRICE, usdForRf, rfPriceText, priceAgeLabel, isShowable, type RfPrice } from "./game/price.js";
import { dailyStreak, DAILY_ATTEMPTS, type DailyScenario } from "./game/daily.js";
import { SHOT_RULES } from "./game/shots.js";
import { COUNT_UP_MS, countUpText, ticksAt } from "./game/countup.js";

// One shared 90 ms ticker drives every spinning ball on screen (drawing = one drawImage from a cached strip).
const spinners = new Set<(frame: number) => void>();
let spinTimer = 0, spinFrame = 0;
function subscribeSpin(draw: (frame: number) => void) {
  spinners.add(draw);
  if (!spinTimer) spinTimer = window.setInterval(() => { spinFrame = (spinFrame + 1) % BALL_FRAMES; spinners.forEach(fn => fn(spinFrame)); }, 90);
  return () => { spinners.delete(draw); if (!spinners.size) { window.clearInterval(spinTimer); spinTimer = 0; } };
}

/** A rotating pixel ball (8-frame spin, sheen on the higher tiers) with its ground shadow, on a small canvas. */
export function BallSpin({ rarity, size, spinning = true, season = "S1", pedestal = false }: { rarity: number; size: number; spinning?: boolean; season?: "S0" | "S1"; pedestal?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sprite = size >= 30 ? 32 : 24, margin = Math.max(1, Math.round(sprite / 7)), cell = sprite + margin * 2, height = cell + (pedestal ? 7 : 3);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    const reduced = ballReducedMotion(), id = BALL_IDENTITY[rarity] ?? BALL_IDENTITY[7];
    const draw = (frame: number) => {
      context.clearRect(0, 0, cell, height);
      if (pedestal) {
        context.fillStyle = "#0b0d1a"; context.fillRect(3, height - 5, cell - 6, 5);
        context.fillStyle = id.trim === id.base ? id.accent : id.trim; context.fillRect(4, height - 5, cell - 8, 1);
        context.fillStyle = "#2a3160"; context.fillRect(4, height - 4, cell - 8, 3);
      }
      drawBallShadow(context, cell / 2, margin + sprite + (pedestal ? 0 : 1), sprite);
      drawBallSprite(context, cell / 2, margin + sprite / 2, sprite, rarity, season, frame, reduced);
    };
    draw(0);
    return spinning && !reduced ? subscribeSpin(draw) : undefined;
  }, [rarity, spinning, season, pedestal, sprite, cell, height, margin]);
  return <canvas ref={ref} width={cell} height={height} className="pk-ballspin" style={{ width: size, height: Math.round(size * height / cell) }} aria-hidden="true" />;
}

/** CSS glow behind a ball, in its rarity colours (display case and pack cards). */
export function ballGlow(rarity: number, season: "S0" | "S1" = "S1"): string {
  const id = BALL_IDENTITY[rarity] ?? BALL_IDENTITY[7];
  const color = season === "S0" ? "#c9b08a" : rarity >= 5 ? "#ffd23f" : rarity === 0 ? "#8a7a66" : id.accent;
  return `radial-gradient(circle at 50% 38%, ${color}${rarity >= 4 ? "66" : "40"} 0, ${color}00 62%)`;
}

/** Kit bag display case: each ball on a pedestal with its name, odds and RF value. */
export function BallCase({ definition, tag }: { definition: GameDefinition; tag: string }) {
  return <div className="pk-case" role="list">
    {definition.outcomes.map((outcome, index) => <div className="pk-pedestal" role="listitem" key={outcome.name} data-rarity={index}
      style={{ backgroundImage: `${ballGlow(index)}, linear-gradient(transparent 55%, #8883 56%)`, borderColor: index >= 5 ? "#ff8c00" : index === 4 ? "#d7dde5" : undefined }}>
      <BallSpin rarity={index} size={48} pedestal />
      <strong>{RARITY_NAMES[index]}</strong>
      <small>{outcome.chanceBps / 100}% · {formatGameAmount(outcome.reward, 18)} RF{tag}</small>
    </div>)}
  </div>;
}

/** A tiny pixel ball in a rarity's own colours (odds table, Bag counts): 8 × 8 rects, crisp at any size. */
export function RarityChip({ rarity }: { rarity: number }) {
  const id = BALL_IDENTITY[rarity] ?? BALL_IDENTITY[7];
  return <svg className="pk-rchip" viewBox="0 0 8 8" width="12" height="12" shapeRendering="crispEdges" aria-hidden="true">
    <path fill={id.outline} d="M2 0h4v1h1v1h1v4h-1v1h-1v1h-4v-1h-1v-1h-1v-4h1v-1h1z" />
    <path fill={id.base} d="M2 1h4v1h1v4h-1v1h-4v-1h-1v-4h1z" />
    <path fill={id.accent} d="M3 3h2v2h-2zM3 1h2v1h-2zM1 3h1v2h-1zM6 3h1v2h-1zM3 6h2v1h-2z" />
    <path fill={id.spec} d="M2 2h1v1h-1z" />
  </svg>;
}

/** A stat tile: a big number over a short label. */
export function Tile({ value, label, tone }: { value: ReactNode; label: ReactNode; tone?: "gold" | "volt" | "sky" }) {
  return <div className="pk-tile" data-tone={tone}><b>{value}</b><span>{label}</span></div>;
}

/** The exact odds table: chance and RF value of every ball, with the 90% average return. */
export function OddsTable({ definition, tier, tag }: { definition: GameDefinition; tier: Tier; tag: string }) {
  return <>
    <table className="pk-odds pk-oddstable"><thead><tr><th>Ball</th><th>Chance</th><th>RF value</th><th>$GBOOT drop</th></tr></thead>
      <tbody>{definition.outcomes.map((item, index) => <tr key={item.name} data-rarity={index}>
        <td><span className="pk-rname"><RarityChip rarity={index} />{RARITY_NAMES[index]}</span></td><td>{item.chanceBps / 100}%</td><td>{formatGameAmount(item.reward, 18)}{tag}</td>
        <td>+{formatNumber(Math.round(tier.baseDrop * RARITIES[index].dropMult * 100) / 100)}{tag}</td></tr>)}</tbody></table>
    <div className="pk-callout">
      <Tile value="90%" label="average return" tone="volt" />
      <p><b>Average return: 90%</b> of the ball price in RF, over many balls. Individual results vary: most balls return less than they cost, a few return much more. The kick never changes which ball you get.</p>
    </div>
  </>;
}

/** Per-stadium prices and top prizes (true figures from the tier data; USD from the live RF price). */
export function StadiumPrices({ source, now }: { source: PrizeSource; now: number }) {
  const price = source.price ?? NO_PRICE;
  return <>
    <table className="pk-odds"><thead><tr><th>Stadium</th><th>Ball price</th><th>Top prize (10×)</th></tr></thead>
      <tbody>{TIERS.map(tier => {
        const line = prizeLine(source.kind === "simulated" ? { ...source, topPrizeRF: tier.priceRF * 10 } : { ...source, topPrizeRF: source.topPrizeRF === null ? null : tier.priceRF * 10 }, "topPrizeRF", now);
        return <tr key={tier.id} data-stadium={tier.id}><td><span className="pk-rname"><i className="pk-stadiumdot" aria-hidden="true" />{tier.name}</span></td><td>{tier.priceRF.toLocaleString("en-US")} RF <small>{usdForRf(tier.priceRF, price, now)}</small></td><td>{line.value} <small>{line.usd}</small></td></tr>;
      })}</tbody></table>
    <RfPriceLine price={price} now={now} />
  </>;
}

/** "RF price: 1 RF ≈ $0.00155 · live · 12s ago", or a dash when the pool reads failed. */
export function RfPriceLine({ price, now }: { price: RfPrice; now: number }) {
  return <p className="pk-note" data-testid="rf-price" data-status={isShowable(price, now) ? "live" : "error"}>
    RF price: {rfPriceText(price, now)}{isShowable(price, now) ? ` · ${priceAgeLabel(price, now)}` : ""} <small>(Uniswap v4 RF/WETH × WETH/USDG on Robinhood Chain)</small>
  </p>;
}

/** "RF: … / Ball: … / $GBOOT: … / Lace: … / Burn: …" (economy TOKEN_LINES, word for word). */
export function TokenExplainer() {
  return <ul className="pk-tokens" data-testid="token-lines">{TOKEN_LINES.map(([term, text]) => <li key={term}><b>{term}:</b> {text}</li>)}</ul>;
}

export function ModeSelect({ progress, onPick }: { progress: Progress; onPick: (mode: ModeId) => void }) {
  const { level } = levelFromXp(progress.xp);
  return <div className="pk-modes">
    {MODES.map(mode => {
      const open = isUnlocked(mode.id, progress);
      return <button key={mode.id} type="button" className={mode.paid ? "pk-mode pk-mode-paid" : "pk-mode"} disabled={!open} onClick={() => onPick(mode.id)} data-testid={`mode-${mode.id}`}>
        <strong>{mode.name}</strong><small>{open ? mode.blurb : `Unlocks at level ${mode.level} (you are ${level})`}</small>
      </button>;
    })}
  </div>;
}

/** World Tour (round 6 C16): a path of 6 cities × 5 levels; the next level is highlighted; stars open the next city. */
export function TourMap({ levels, progress, onPick }: { levels: readonly Level[]; progress: Progress; onPick: (level: Level) => void }) {
  const stars = totalStars(progress), next = nextLevel(levels, progress);
  return <div className="pk-tour">
    <div className="pk-callout">
      <Tile value={<>★ {stars}<small>/{levels.length * 3}</small></>} label="stars" tone="gold" />
      <p className="pk-note">{CITIES.length} cities, {LEVELS_PER_CITY} levels each. Earn {starsToOpen()} of a city's {LEVELS_PER_CITY * 3} stars to open the next city; 3-star finals unlock cosmetics.</p>
    </div>
    <ol className="pk-path">{CITIES.map(city => {
      const list = cityLevels(levels, city.chapter), open = cityOpen(levels, city.chapter, progress), got = cityStars(levels, city.chapter, progress);
      const before = CITIES.find(item => item.chapter === city.chapter - 1);
      const need = before ? starsToOpen(cityLevels(levels, before.chapter).length) : 0, have = before ? cityStars(levels, before.chapter, progress) : 0;
      return <li key={city.chapter} className="pk-city" data-open={open} data-testid={`city-${city.chapter}`}>
        <h3>{city.chapter}. {city.name} <small>{city.stadium === "park" ? "Park" : city.stadium === "pro" ? "Pro" : "Champions"} stadium · ★ {got}/{list.length * 3}</small></h3>
        {!open && before && <p className="pk-note">Locked: get ★ {need} in {before.name} to open (you have {have}).</p>}
        <div className="pk-levels pk-levelpath">{list.map((level, index) => {
          const done = progress.stars[level.id] ?? 0, keeper = keeperById(level.keeper).name, isNext = next?.id === level.id;
          return <button key={level.id} type="button" disabled={!open} onClick={() => onPick(level)} autoFocus={isNext} data-next={isNext || undefined} title={level.objectives.map(o => describe(o, keeper)).join(" · ")} data-testid={`level-${level.id}`}>
            <b>{city.chapter}-{index + 1}. {level.name}{isNext ? <em className="pk-nexttag"> Next</em> : null}</b><small>{level.mode === "freekick" ? `Free kick ${level.setup?.distance} m` : `Penalties vs ${keeper.split(" ")[0]}`}</small>
            <span className="pk-stars" aria-label={`${done} of 3 stars`}>{"★".repeat(done)}{"☆".repeat(3 - done)}</span>
          </button>;
        })}</div></li>;
    })}</ol>
  </div>;
}

export function LevelBrief({ level }: { level: Level }) {
  const keeper = keeperById(level.keeper).name;
  return <ol className="pk-brief">{level.objectives.map((objective, index) => <li key={index}>{"★".repeat(index + 1)} {describe(objective, keeper)}</li>)}</ol>;
}

export function DailyCard({ scenario, progress, today, onPlay, onShare, practice = false }: { scenario: DailyScenario; progress: Progress; today: string; onPlay: () => void; onShare: () => void; practice?: boolean }) {
  const attempts = progress.daily.date === today ? progress.daily.attempts : 0, best = progress.daily.date === today ? progress.daily.best : 0;
  const streak = dailyStreak(progress.daily.played, today);
  const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 6 + i); return d.toISOString().slice(0, 10); });
  return <div className="pk-daily">
    <h3>{today} · {scenario.title}</h3>
    <p className="pk-note">The same scenario for every player today.</p>
    <div className="pk-tiles">
      <Tile value={DAILY_ATTEMPTS - attempts} label={<>{practice ? "Practice attempts" : "Attempts"} left:</>} tone="volt" />
      <Tile value={formatNumber(best)} label="your best today" tone="gold" />
      <Tile value={`${streak} day${streak === 1 ? "" : "s"}`} label="streak" tone="sky" />
    </div>
    <p className="pk-calendar" aria-label="Last 7 days">{week.map(day => <i key={day} data-played={progress.daily.played.includes(day)} title={day}>{day.slice(8)}</i>)}</p>
    <button type="button" className="pk-primary" disabled={attempts >= DAILY_ATTEMPTS} onClick={onPlay}>{attempts >= DAILY_ATTEMPTS ? "Come back tomorrow" : "Play today's challenge"}</button>
    {best > 0 && <button type="button" onClick={onShare}>Share result card</button>}
    {practice && <p className="pk-note" data-testid="daily-practice">This preview can't save between visits, so the 3-attempt limit resets when you reload: treat these as practice attempts. Your save code (Settings) keeps your streak and best.</p>}
  </div>;
}

export function ScoutingBook({ progress, discovery }: { progress: Progress; discovery?: { label: string } }) {
  const streaks = [3, 5, 10].map(n => `${n} in a row ×${streakMultiplier(n)}`).join(" · ");
  return <div className="pk-book">
    {/* Discovery meter: Match Director moments seen, keepers met or scouted, stadiums played. */}
    {discovery && <p className="pk-discovery" data-testid="discovery">{discovery.label}</p>}
    {/* The numbers kept off the pitch (round 6 C15): difficulty, multipliers, keeper reads. */}
    <h3>How scoring works</h3>
    <ul className="pk-scoring" data-testid="scoring">
      <li><b>Challenge level:</b> {rungName(progress.difficulty)} (it adjusts between rounds to how you play, from Sunday League to Legend).</li>
      <li><b>Where it goes in:</b> centre ×{ZONE_MULT.centre} (and usually saved), side ×{ZONE_MULT.side}, corner ×{ZONE_MULT.corner}, top bin ×{ZONE_MULT.bin}; in off the post +{Math.round((POST_IN_BONUS - 1) * 100)}%; a free-kick knuckleball ×2.</li>
      <li><b>Goals in a row:</b> {streaks} (the most is ×{streakMultiplier(99)}; points only, never RF or $GBOOT). <b data-testid="book-best-streak">BEST STREAK: {progress.bestStreak} in a row</b>.</li>
      <li><b>PERFECT strike:</b> {SHOT_RULES.perfect}</li>
      <li><b>Keepers:</b> each card shows how often the keeper dives the right way (before your challenge level) and the points multiplier for scoring past them.</li>
      <li><b>Big Match:</b> the ball you kick with multiplies your points by its rarity (Scuffed ×1 up to Golden Boot ×15), and sudden death doubles them. None of this changes what a ball is worth in RF.</li>
      <li><b>Target Practice:</b> rings are worth 100, 200 or 500; hits in a row multiply them (up to ×5); the crossbar adds 250.</li>
    </ul>
    <h3>Keepers ({progress.stamps.length}/{KEEPERS.length} stamped)</h3>
    <div className="pk-book-grid">{LADDER.map(id => <KeeperCard key={id} id={id} stamped={progress.stamps.includes(id)} seen={progress.keepersSeen.includes(id)} />)}</div>
    <h3>Ball Collection ({new Set(progress.pulled).size}/7 pulled)</h3>
    <div className="pk-case">{RARITY_NAMES.slice(0, 7).map((name, index) => <div className="pk-pedestal" key={name} data-pulled={progress.pulled.includes(index)}>
      <BallSpin rarity={index} size={36} spinning={progress.pulled.includes(index)} />
      <strong>{progress.pulled.includes(index) ? name : "???"}</strong><small>{progress.pulled.includes(index) ? "pulled" : "not pulled yet"}</small></div>)}</div>
  </div>;
}

function KeeperCard({ id, stamped, seen = false }: { id: KeeperId; stamped: boolean; seen?: boolean }) {
  return <div className="pk-keepercard" data-stamped={stamped} data-seen={seen || stamped}>
    <KeeperPortrait id={id} lit={stamped || seen} />
    <strong>{keeperById(id).name}{stamped ? " ✓" : seen ? " · scouted" : ""}</strong>
    <KeeperFacts id={id} />
  </div>;
}
function KeeperPortrait({ id, lit }: { id: KeeperId; lit: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false; context.clearRect(0, 0, 64, 64);
    drawKeeper(context, id, { x: 32, y: 60, rotate: 0, stretch: 1, armL: -0.5, armR: -0.5, alpha: lit ? 1 : 0.35, scaleMul: 0.8, mood: "idle" }, 0);
  }, [id, lit]);
  return <canvas ref={ref} width={64} height={64} aria-hidden="true" />;
}
function KeeperFacts({ id }: { id: KeeperId }) {
  const profile = keeperById(id);
  return <>
    <small>{profile.bio}</small>
    <small><b>Tell:</b> {profile.tell} · dives the right way {Math.round(profile.read * 100)}% of the time · points ×{profile.mult}</small>
  </>;
}

/** B9: the Results count-up clock (0 → 1). Outside Results it is 1, so a Count there shows its final text. */
const CountClock = createContext(1);

/** A figure that counts up from 0 to `text` with the Results clock; `data-final` marks the exact final value. */
export function Count({ text }: { text: string }) {
  const t = useContext(CountClock);
  return <span className="pk-count" data-value={text} data-final={t >= 1 || undefined}>{t >= 1 ? text : countUpText(text, t)}</span>;
}

/**
 * The clock behind every Count on one Results card: COUNT_UP_MS long, eased per figure, with a rising tick
 * (`onTick(0…6)`) as it goes. Reduced motion (OS or Settings) or nothing to count: final at once, no ticks.
 */
function useCountClock(reduced: boolean, active: boolean, onTick?: (index: number) => void) {
  const still = reduced || !active || typeof requestAnimationFrame === "undefined";
  const [t, setT] = useState(still ? 1 : 0);
  const tick = useRef(onTick); tick.current = onTick;
  useEffect(() => {
    if (still) { setT(1); return; }
    const began = performance.now();
    let frame = 0, played = 0;
    const step = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - began) / COUNT_UP_MS)), due = ticksAt(k);
      while (played < due) tick.current?.(played++);
      setT(k);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    const safety = window.setTimeout(() => { cancelAnimationFrame(frame); setT(1); }, COUNT_UP_MS + 400); // a hidden tab pauses rAF: still end on the true values
    return () => { cancelAnimationFrame(frame); window.clearTimeout(safety); };
  }, [still]);
  return t;
}

export type SessionSummary = { title: string; kicks: number; goals: number; points: number; xp: number; stars?: number; stamp?: string; unlocked?: string[];
  /** C2: the most goals in a row this session, and whether it beat the all-time BEST STREAK. */
  bestStreak?: number; newBest?: boolean;
  /** A plain final-score line (Big Match). */
  final?: string;
  /** First session: the keeper-unlock card that flips into the Scouting Book, plus the next-mode teaser. */
  scouted?: { keeper: KeeperId; card: string; teaser: string };
  /** Big Match lines (their RF / $GBOOT / Cup figures are <Count>s, so they count up with the tiles). */
  match?: { rf: ReactNode; gboot: ReactNode; race: ReactNode; toTop10: string } };
export function Results({ summary, onAgain, onModes, next, goal, onBook, cup, reduced = false, onTick }: { summary: SessionSummary; onAgain: () => void; onModes: () => void; next?: { onNext: () => void } | { locked: string } | null;
  /** B9: the NEXT GOAL (game/nextgoal.ts), the primary button when there is no World Tour "Next level". */
  goal?: { text: string; mode: string; onGo: () => void } | null;
  onBook?: () => void; /** C3c: the Cup pot and your entries this week. */ cup?: ReactNode;
  /** B9: reduced motion (OS or Settings): figures final at once; `onTick(i)` plays the i-th rising count-up tick. */
  reduced?: boolean; onTick?: (index: number) => void }) {
  const hasNext = Boolean(next && "onNext" in next), goalFirst = !hasNext && Boolean(goal);
  const counting = summary.goals > 0 || summary.points > 0 || summary.xp > 0 || Boolean(summary.match);
  const t = useCountClock(reduced, counting, onTick), final = t >= 1;
  // The primary button takes focus without scrolling the tiles out of view (QA-4: in either motion mode, and never a
  // scroll after the count): it sits in a sticky footer (.pk-resultfoot), so the tiles and the button are both in view.
  // (A frame later: the SDK GameMenu focuses its dialog in its own mount effect, which runs after this one.)
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => primary.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  return <CountClock.Provider value={t}><div className="pk-roundcard" data-testid="results" data-final={final || undefined}>
    <h3>{summary.title}</h3>
    {summary.stars !== undefined && <p className="pk-stars" aria-label={`${summary.stars} stars`}>{"★".repeat(summary.stars)}{"☆".repeat(3 - summary.stars)}</p>}
    {summary.final ? <p className="pk-final">{summary.final}</p>
      : <div className="pk-tiles">
        <Tile value={<><Count text={String(summary.goals)} /><small>/{summary.kicks}</small></>} label={`goal${summary.goals === 1 ? "" : "s"} scored`} tone="volt" />
        <Tile value={<Count text={formatNumber(summary.points)} />} label="points" tone="gold" />
        {summary.xp > 0 && <Tile value={<>+<Count text={String(summary.xp)} /></>} label="XP earned" tone="sky" />}
      </div>}
    {summary.final && summary.xp > 0 && <p className="pk-note">You earned <Count text={String(summary.xp)} /> XP.</p>}
    {Boolean(summary.bestStreak) && <p className="pk-beststreak" data-testid="best-streak" data-new={Boolean(summary.newBest)}>BEST STREAK: <b>{summary.bestStreak}</b> in a row{summary.newBest ? " · NEW RECORD!" : ""}</p>}
    {summary.stamp && <p className="pk-badge" data-icon="book">Scouting Book: <b>{summary.stamp}</b> stamped.</p>}
    {summary.unlocked?.map(item => <p key={item} className="pk-badge" data-icon="key">Unlocked: <b>{item}</b></p>)}
    {summary.scouted && <div className="pk-unlockcard" data-testid="unlock-card">
      <p className="pk-badge" data-icon="book"><b>{summary.scouted.card}</b></p>
      {/* The rival's card flips over into its Scouting Book page (CSS; reduced motion shows both, still). */}
      <div className="pk-unlock-flip">
        <div className="pk-unlock-front"><KeeperPortrait id={summary.scouted.keeper} lit /><strong>{keeperById(summary.scouted.keeper).name}</strong></div>
        <div className="pk-unlock-back"><small>Scouting Book · new page</small><strong>{keeperById(summary.scouted.keeper).name} · scouted</strong><small><b>Tell:</b> {keeperById(summary.scouted.keeper).tell}</small></div>
      </div>
      {/* QA-2: one "what next" only. With a NEXT GOAL button the teaser would name a different mode, so it goes. */}
      {!goalFirst && <p className="pk-note" data-testid="teaser">{summary.scouted.teaser}</p>}
      {onBook && <button type="button" className="pk-link" onClick={onBook} data-testid="open-book">Open the Scouting Book</button>}
    </div>}
    {summary.match && <ul className="pk-plain" data-testid="match-summary"><li>{summary.match.rf}</li><li>{summary.match.gboot}</li><li>{summary.match.race} {summary.match.toTop10}</li><li>Your kicks never change what your balls are worth.</li></ul>}
    {cup}
    {next && "locked" in next && <p className="pk-note" data-testid="next-locked">{next.locked}</p>}
    <div className="pk-resultfoot">
      {goalFirst && goal && <button type="button" ref={primary} className="pk-primary pk-resultgoal" onClick={goal.onGo} data-testid="results-next-goal" data-mode={goal.mode}><b>NEXT GOAL</b> {goal.text} ▸</button>}
      <div className="pk-buyrow">
        {next && "onNext" in next && <button type="button" ref={primary} className="pk-primary" onClick={next.onNext} data-testid="next-level">Next level</button>}
        <button type="button" ref={hasNext || goalFirst ? undefined : primary} className={hasNext || goalFirst ? undefined : "pk-primary"} onClick={onAgain}>Play again</button><button type="button" onClick={onModes}>Modes</button>
      </div>
    </div>
  </div></CountClock.Provider>;
}

/** Difficulty rung → a friendly name (the numbers stay invisible). */
export const rungName = (rung: number) => ["Sunday League", "Sunday League+", "Grassroots", "Amateur", "Semi-pro", "Pro", "International", "World Class", "Legend"][Math.min(DIFFICULTY_LADDER.length - 1, Math.max(0, rung))];
