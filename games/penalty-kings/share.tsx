/**
 * C4 social UI (kept out of index.tsx / ui.tsx so the lanes merge cleanly): the SHARE CARD panel under Results,
 * the CHALLENGE box on the modes screen, the KEEPER OF THE WEEK line and the title's "Day N" badge.
 * Points and XP only. See game/challenge.ts and gfx/sharecard.ts for the rules and the honesty notes.
 */
import { useEffect, useRef, useState } from "react";
import type { KeeperId } from "@penalty-kings/engine";
import { cardImage, shareAbilities, CARD_TAGLINE, type ShareCardInput } from "./gfx/sharecard.js";
import {
  encodeChallenge, decodeChallenge, challengeLink, challengeBrief, streakDay, comeBackLine, weeklyLine,
  CHALLENGE_RULE, PUBLIC_URL, type Challenge, type ShareRound,
} from "./game/challenge.js";
export { shareRoundOf, dailyShareRound } from "./game/challenge.js";
import type { LoginTrack } from "./game/rewards.js";
import "./share.css";

/**
 * Under Results (the challenge verdict is the Results title) and in the Daily Challenge menu (today's best round,
 * `label` "Share result card", no come-back line): one tap to a share card + challenge link. Every share button in
 * the game opens this: the SDK frame has no Web Share and blocks clipboard writes, so nothing may rely on either blindly.
 */
export function SharePanel({ round, rows, halo, login, today, label, comeBack: showComeBack = true }: { round: ShareRound; rows: readonly string[] | null; halo?: string; login: LoginTrack; today: string; label?: string; comeBack?: boolean }) {
  const [card, setCard] = useState<{ url: string; file: File | null; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false), [note, setNote] = useState("");
  const code = round.replay ? encodeChallenge({ ...round.replay, score: round.score, from: round.friendId }) : null;
  const link = code ? challengeLink(code) : PUBLIC_URL;
  const comeBack = showComeBack ? comeBackLine(login, today) : null;
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { // the card in view (inside a scrolling menu too), then focus on "Hide card"; an instant scroll, so reduced motion holds
    if (!card) return;
    dialog.current?.scrollIntoView?.({ block: "nearest" });
    dialog.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, [card]);
  const input: ShareCardInput = { name: `Friend #${round.friendId}`, score: round.score, scoreLabel: "pts", goals: round.goals, kicks: round.kicks, bestStreak: round.bestStreak, subtitle: round.subtitle, link, code: code ?? undefined };
  async function open() {
    setBusy(true); setNote("");
    try { setCard(await cardImage(input, rows, halo)); } catch { setNote("The card could not be drawn here. Copy the link instead."); } finally { setBusy(false); }
  }
  const can = shareAbilities(card?.file ?? null);
  async function share() {
    if (!card?.file) return;
    try { await navigator.share({ files: [card.file], title: "Penalty Kings", text: `${CARD_TAGLINE}: ${link}` }); setNote("Shared."); }
    catch (error) { if ((error as { name?: string })?.name !== "AbortError") setNote("Sharing is blocked here. Long-press or right-click the image to save it."); }
  }
  return <div className="pk-social" data-testid="share-panel">
    {comeBack && <p className="pk-comeback" data-testid="come-back">{comeBack}</p>}
    <button type="button" className="pk-sharebtn" onClick={() => void open()} disabled={busy} data-testid="share-card">{busy ? "Drawing your card…" : label ?? (code ? "Share card + challenge a friend" : "Share card")}</button>
    {note && !card && <p className="pk-note" role="status">{note}</p>}
    {card && <div className="pk-sharecard" role="dialog" aria-label="Your share card" ref={dialog} data-testid="share-dialog">
      <img src={card.url} alt={`Share card: ${input.name}, ${round.score.toLocaleString("en-US")} points, best streak ${round.bestStreak}. ${CARD_TAGLINE}.`} width={640} height={360} data-testid="share-image" data-bytes={card.bytes} />
      <p className="pk-note">Long-press or right-click the image to save it. Tap the {code ? "link or code" : "link"} to select it, then copy.{code ? ` ${CHALLENGE_RULE}` : ""}</p>
      <label className="pk-copy">{code ? "Challenge link" : "Link"}<input readOnly value={link} onFocus={event => event.currentTarget.select()} data-testid="share-link" /></label>
      {code && <label className="pk-copy">Challenge code (paste it in the game's Challenge box)<input readOnly value={code} onFocus={event => event.currentTarget.select()} data-testid="challenge-code" /></label>}
      <div className="pk-buyrow">
        {can.share && <button type="button" className="pk-primary" onClick={() => void share()} data-testid="share-native">Share</button>}
        {can.download && <a className="pk-sharebtn" href={card.url} download="penalty-kings.png" data-testid="share-download">Save image</a>}
        <button type="button" data-autofocus onClick={() => setCard(null)} data-testid="share-hide">Hide card</button>
      </div>
      {note && <p className="pk-note" role="status">{note}</p>}
    </div>}
  </div>;
}

/** Modes screen: "Got a challenge code?" — collapsed to one line until opened. */
export function ChallengeBox({ onPlay }: { onPlay: (challenge: Challenge) => void }) {
  const [code, setCode] = useState(""), [error, setError] = useState("");
  const decoded = code.trim() ? decodeChallenge(code) : null;
  return <details className="pk-challengebox" data-testid="challenge-box">
    <summary>Got a challenge code?</summary>
    <p className="pk-note">{CHALLENGE_RULE}</p>
    <label>Paste the code<input value={code} onChange={event => { setCode(event.target.value); setError(""); }} placeholder="pkc1.…" spellCheck={false} autoCapitalize="off" data-testid="challenge-in" /></label>
    {decoded?.ok && <p className="pk-note" data-testid="challenge-brief">{challengeBrief(decoded.challenge)}</p>}
    <button type="button" className="pk-primary" disabled={!code.trim()} data-testid="challenge-play" onClick={() => {
      const result = decodeChallenge(code);
      if (result.ok) onPlay(result.challenge); else setError(result.reason);
    }}>Play the challenge</button>
    {error && <p role="alert" className="pk-note" data-testid="challenge-error">{error}</p>}
  </details>;
}

/** Modes screen: one line under NEXT GOAL. */
export function WeeklyKeeper({ keeper, onPlay }: { keeper: KeeperId; onPlay: () => void }) {
  return <button type="button" className="pk-weekly" data-testid="weekly-keeper" data-keeper={keeper} onClick={onPlay} aria-label={`${weeklyLine(keeper)}. Play now.`}>{weeklyLine(keeper)} ▸</button>;
}

/** Title screen: "Day N 🔥" while the check-in run is alive. */
export function StreakBadge({ login, today }: { login: LoginTrack; today: string }) {
  const day = streakDay(login, today);
  if (day === null) return null;
  return <strong className="pk-streakday" data-testid="streak-day" title="Daily check-in: come back each day for more XP">Day {day} <span aria-hidden="true">🔥</span></strong>;
}

