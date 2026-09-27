/** Screens and widgets for the game shell (all state lives in index.tsx). */
import { useEffect, useRef } from "react";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import type { ChanceGameDefinition as GameDefinition } from "@rarefriends/friendsdk/game";
import { KEEPERS, keeperById, DIFFICULTY_LADDER, type KeeperId } from "@penalty-kings/engine";
import { RARITIES, TIERS, TOKEN_LINES, formatNumber, type Tier } from "./economy.js";
import { drawBallSprite, drawBallShadow, ballReducedMotion, BALL_FRAMES, BALL_IDENTITY } from "./gfx/ball.js";
import { drawKeeper } from "./gfx/keepers.js";
import { RARITY_NAMES } from "./gfx/stage.js";
import { MODES, isUnlocked, levelFromXp, totalStars, STADIUM_STARS, LADDER, type Progress, type ModeId } from "./game/progress.js";
import { describe, type Level } from "./game/objectives.js";
import { prizeLine, type PrizeSource } from "./game/prizes.js";
import { NO_PRICE, usdForRf, rfPriceText, priceAgeLabel, isShowable, type RfPrice } from "./game/price.js";
import { dailyStreak, DAILY_ATTEMPTS, type DailyScenario } from "./game/daily.js";

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

/** The exact odds table: chance and RF value of every ball, with the 90% average return. */
export function OddsTable({ definition, tier, tag }: { definition: GameDefinition; tier: Tier; tag: string }) {
  return <>
    <table className="pk-odds"><thead><tr><th>Ball</th><th>Chance</th><th>RF value</th><th>$GBOOT drop</th></tr></thead>
      <tbody>{definition.outcomes.map((item, index) => <tr key={item.name}>
        <td>{RARITY_NAMES[index]}</td><td>{item.chanceBps / 100}%</td><td>{formatGameAmount(item.reward, 18)}{tag}</td>
        <td>+{formatNumber(Math.round(tier.baseDrop * RARITIES[index].dropMult * 100) / 100)}{tag}</td></tr>)}</tbody></table>
    <p><b>Average return: 90%</b> of the ball price in RF, over many balls. Individual results vary: most balls return less than they cost, a few return much more. The kick never changes which ball you get.</p>
  </>;
}

/** Per-stadium prices and top prizes (true figures from the tier data; USD from the live RF price). */
export function StadiumPrices({ source, now }: { source: PrizeSource; now: number }) {
  const price = source.price ?? NO_PRICE;
  return <>
    <table className="pk-odds"><thead><tr><th>Stadium</th><th>Ball price</th><th>Top prize (10×)</th></tr></thead>
      <tbody>{TIERS.map(tier => {
        const line = prizeLine(source.kind === "simulated" ? { ...source, topPrizeRF: tier.priceRF * 10 } : { ...source, topPrizeRF: source.topPrizeRF === null ? null : tier.priceRF * 10 }, "topPrizeRF", now);
        return <tr key={tier.id}><td>{tier.name}</td><td>{tier.priceRF.toLocaleString("en-US")} RF <small>{usdForRf(tier.priceRF, price, now)}</small></td><td>{line.value} <small>{line.usd}</small></td></tr>;
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

export function TourMap({ levels, progress, onPick }: { levels: readonly Level[]; progress: Progress; onPick: (level: Level) => void }) {
  const stars = totalStars(progress);
  return <div className="pk-tour">
    <p>★ {stars} / {levels.length * 3}. Stars open the next stadium, and 3-star finals unlock cosmetics.</p>
    {(["park", "pro", "champions"] as const).map(stadium => {
      const open = stars >= STADIUM_STARS[stadium];
      return <section key={stadium}><h3>{stadium === "park" ? "Park" : stadium === "pro" ? "Pro" : "Champions"}{open ? "" : ` · needs ★ ${STADIUM_STARS[stadium]}`}</h3>
        <div className="pk-levels">{levels.filter(level => level.stadium === stadium).map((level, index) => {
          const got = progress.stars[level.id] ?? 0, keeper = keeperById(level.keeper).name;
          return <button key={level.id} type="button" disabled={!open} onClick={() => onPick(level)} title={level.objectives.map(o => describe(o, keeper)).join(" · ")} data-testid={`level-${level.id}`}>
            <b>{index + 1}. {level.name}</b><small>{level.mode === "freekick" ? `Free kick ${level.setup?.distance} m` : `Penalties vs ${keeper.split(" ")[0]}`}</small>
            <span className="pk-stars" aria-label={`${got} of 3 stars`}>{"★".repeat(got)}{"☆".repeat(3 - got)}</span>
          </button>;
        })}</div></section>;
    })}
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
    <p>The same scenario for every player today. {practice ? "Practice attempts" : "Attempts"} left: <b>{DAILY_ATTEMPTS - attempts}</b> · your best today: <b>{formatNumber(best)}</b> · streak: <b>{streak} day{streak === 1 ? "" : "s"}</b></p>
    <p className="pk-calendar" aria-label="Last 7 days">{week.map(day => <i key={day} data-played={progress.daily.played.includes(day)} title={day}>{day.slice(8)}</i>)}</p>
    <button type="button" className="pk-primary" disabled={attempts >= DAILY_ATTEMPTS} onClick={onPlay}>{attempts >= DAILY_ATTEMPTS ? "Come back tomorrow" : "Play today's challenge"}</button>
    {best > 0 && <button type="button" onClick={onShare}>Share result card</button>}
    {practice && <p className="pk-note" data-testid="daily-practice">This preview can't save between visits, so the 3-attempt limit resets when you reload: treat these as practice attempts. Your save code (Settings) keeps your streak and best.</p>}
  </div>;
}

export function ScoutingBook({ progress }: { progress: Progress }) {
  return <div className="pk-book">
    <h3>Keepers ({progress.stamps.length}/{KEEPERS.length} stamped)</h3>
    <div className="pk-book-grid">{LADDER.map(id => <KeeperCard key={id} id={id} stamped={progress.stamps.includes(id)} />)}</div>
    <h3>Ball Collection ({new Set(progress.pulled).size}/7 pulled)</h3>
    <div className="pk-case">{RARITY_NAMES.slice(0, 7).map((name, index) => <div className="pk-pedestal" key={name} data-pulled={progress.pulled.includes(index)}>
      <BallSpin rarity={index} size={36} spinning={progress.pulled.includes(index)} />
      <strong>{progress.pulled.includes(index) ? name : "???"}</strong><small>{progress.pulled.includes(index) ? "pulled" : "not pulled yet"}</small></div>)}</div>
  </div>;
}

function KeeperCard({ id, stamped }: { id: KeeperId; stamped: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null), profile = keeperById(id);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false; context.clearRect(0, 0, 64, 64);
    drawKeeper(context, id, { x: 32, y: 60, rotate: 0, stretch: 1, armL: -0.5, armR: -0.5, alpha: stamped ? 1 : 0.35, scaleMul: 0.8, mood: "idle" }, 0);
  }, [id, stamped]);
  return <div className="pk-keepercard" data-stamped={stamped}>
    <canvas ref={ref} width={64} height={64} aria-hidden="true" />
    <strong>{profile.name}{stamped ? " ✓" : ""}</strong>
    <small>{profile.bio}</small>
    <small><b>Tell:</b> {profile.tell} · reads {Math.round(profile.read * 100)}% · score ×{profile.mult}</small>
  </div>;
}

export type SessionSummary = { title: string; kicks: number; goals: number; points: number; xp: number; stars?: number; stamp?: string; unlocked?: string[];
  match?: { rf: string; gboot: string; race: string; toTop10: string } };
export function Results({ summary, onAgain, onModes }: { summary: SessionSummary; onAgain: () => void; onModes: () => void }) {
  return <div className="pk-roundcard" data-testid="results">
    <h3>{summary.title}</h3>
    <p><b>{summary.goals}</b> goals from {summary.kicks} kicks · <b>{formatNumber(summary.points)}</b> points · +{summary.xp} XP</p>
    {summary.stars !== undefined && <p className="pk-stars" aria-label={`${summary.stars} stars`}>{"★".repeat(summary.stars)}{"☆".repeat(3 - summary.stars)}</p>}
    {summary.stamp && <p>Scouting Book: <b>{summary.stamp}</b> stamped.</p>}
    {summary.unlocked?.map(item => <p key={item}>Unlocked: <b>{item}</b></p>)}
    {summary.match && <p>This session: {summary.match.rf} · {summary.match.gboot} · race {summary.match.race} · {summary.match.toTop10}</p>}
    <div className="pk-buyrow"><button type="button" className="pk-primary" onClick={onAgain} autoFocus>Play again</button><button type="button" onClick={onModes}>Modes</button></div>
  </div>;
}

/** Difficulty rung → a friendly name (the numbers stay invisible). */
export const rungName = (rung: number) => ["Sunday League", "Sunday League+", "Grassroots", "Amateur", "Semi-pro", "Pro", "International", "World Class", "Legend"][Math.min(DIFFICULTY_LADDER.length - 1, Math.max(0, rung))];
