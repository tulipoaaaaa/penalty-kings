/**
 * The commentator ("Clive Crossbar", an original character): 150+ context-aware one-liners,
 * never repeating a line until its context's pool is used up. {friend} and {keeper} are filled in.
 */
import type { KeeperId } from "@penalty-kings/engine";
import { LINE_COUNT, BANTER_COUNT, lineTemplate } from "@penalty-kings/game-director";

export type CommentaryContext =
  | "walkout" | "buildup" | "goal" | "save" | "post" | "crossbar" | "over" | "wide" | "streak2" | "streak3" | "rarity-high" | "rarity-top"
  | "keeper" | "sudden-death" | "boss" | "wall" | "freekick" | "target" | "knuckle" | "top-bin" | "post-in" | "panenka"
  | "timeout" | "level-up" | "stamp" | "tutorial-1" | "here-comes-trouble" | "tutorial-2" | "tutorial-3" | "rain" | "snow" | "fog" | "wave"
  | "cold-streak" | "daily" | "tour" | "curler" | "near-miss" | "showreel" | "lucky-ball" | "veteran-ball" | "pack" | `intro:${KeeperId}`
  /** A Match Director line (see cueLine): Stage.say() shows it verbatim. */
  | `line:${string}`;

const LINES: Readonly<Record<string, readonly string[]>> = {
  walkout: ["And here comes {friend}, cool as a cucumber.", "What an entrance from {friend}!", "The crowd rise for {friend}.", "{friend} steps out of the tunnel. Goosebumps.", "Listen to that noise for {friend}!", "{friend} kisses the badge on the way out."],
  buildup: ["The stadium holds its breath...", "Deep breaths now.", "{keeper} is bouncing on the line.", "You could hear a pin drop.", "This is the moment.", "Eyes on the ball, {friend}.", "The ref checks his watch.", "Nobody's sitting down for this one."],
  goal: ["GOOOAL! Top drawer!", "Absolutely buried it!", "No chance for {keeper}!", "Right in the onion bag!", "That's in the history books!", "Cool as you like!", "Get the net-mender on the phone!", "What a finish from {friend}!", "Pass it into the net, why don't you!", "The keeper's still looking for it!", "Unstoppable!", "Clinical. Absolutely clinical."],
  save: ["Saved! {keeper} says no!", "What a stop from {keeper}!", "Denied!", "{keeper} reads it all the way.", "Gloves of steel!", "That was always going to be saved.", "Fingertips! {keeper} gets there!", "{keeper} guessed right.", "Straight at the keeper. Wasted."],
  crossbar: ["OFF THE BAR! Ooooh!", "Crossbar! The whole frame is shaking.", "Rattled the bar!", "Clang! Off the underside of the bar!"],
  post: ["OFF THE POST! Ooooh!", "Woodwork! The post is still shaking.", "Inches away!", "The frame of the goal saves {keeper}!", "Clang! Hear that?"],
  over: ["Row Z! Somebody catch that!", "That's gone into orbit.", "A souvenir for the fans!", "Aim lower, friend.", "That's landed in the car park."],
  wide: ["Wide! Just wide!", "Dragged it past the post.", "The corner flag had no chance.", "Wrong side of the post.", "The side netting fools a few in the crowd!"],
  "near-miss": ["Inches! Actual inches!", "So close you could hear the crowd gasp.", "That kissed the paint!", "A coat of varnish away!"],
  streak2: ["{friend} is heating up!", "Two in a row. Feel the heat.", "Somebody stop {friend}!", "Back to back!"],
  streak3: ["{friend} is ON FIRE!", "Unstoppable! Absolutely unstoppable!", "Hat-trick hero!", "Call the fire brigade!", "Is there anything {friend} can't do?"],
  "cold-streak": ["Keep the head up, {friend}.", "It'll come. It always comes.", "Shake it off. Next one.", "Even the greats miss."],
  "rarity-high": ["Ooh, a shiny ball!", "That ball's worth a closer look.", "Now that's a proper ball."],
  "rarity-top": ["A GOLDEN BOOT BALL! Hold everything!", "Gold! Pure gold!", "The Golden Boot! I've gone all goosebumpy!"],
  keeper: ["Facing {keeper} today.", "{keeper} has a reputation.", "Watch {keeper}'s feet.", "Study the keeper, {friend}."],
  "sudden-death": ["Sudden death. Double points till you miss.", "One kick at a time now.", "Nerves of steel required."],
  boss: ["THE FINAL WALL rises...", "Nobody has ever beaten THE FINAL WALL twice.", "The ground is shaking. It's HIM."],
  wall: ["Straight into the wall!", "The wall stands firm!", "Charged down!", "Somebody's going to feel that one.", "The wall jumped and it worked."],
  freekick: ["Free kick. Plenty of options here.", "Over the wall or round it?", "The wall is set. The ref steps back.", "A lovely distance for a curler.", "Check the wind, {friend}."],
  curler: ["Bent it like a banana!", "Round the wall and in!", "What a curler!", "That swerved like a shopping trolley!"],
  knuckle: ["A knuckleball! It's moving all over the place!", "No spin, all chaos!", "The keeper didn't know where that was going. Neither did I!"],
  "top-bin": ["TOP BINS! Where the owl sleeps!", "Right in the postage stamp!", "Top corner. Take a bow.", "Cobwebs removed from the top corner!"],
  "post-in": ["IN OFF THE POST! Cheeky!", "Post and in! The luck of the brave!", "Kissed the post on the way in!"],
  panenka: ["A PANENKA! The audacity!", "Chipped down the middle! Ice in the veins!", "The keeper dived. The ball floated. Genius."],
  timeout: ["The clock beat you there.", "Too slow! Shot clock!", "Take the shot, {friend}!"],
  target: ["Pick your targets!", "Clock's ticking!", "Aim small, miss small.", "Go for the gold rings!"],
  "level-up": ["{friend} levels up! New challenges unlocked.", "The coaches are impressed. Level up!"],
  stamp: ["{keeper} beaten! Stamp that Scouting Book.", "Another keeper conquered!"],
  "tutorial-1": ["Welcome! Swipe up from the ball towards a corner.", "First kick: a quick swipe towards the corner."],
  "here-comes-trouble": ["Here comes trouble… where's the keeper gone?", "Hold on, who's that in goal? Here comes trouble!"],
  "tutorial-2": ["Lovely. Now curve your swipe to bend it round the keeper."],
  "tutorial-3": ["Last one: top bins are worth five times the points. Go high!"],
  rain: ["It's absolutely chucking it down.", "Slippery ball tonight."],
  snow: ["Snow on the pitch! Orange ball weather.", "A winter wonderland out there."],
  fog: ["I can barely see the goal from up here!", "Foggy one tonight. The keeper might not see it either."],
  wave: ["Here comes the Mexican wave!", "The whole stadium is on its feet!"],
  daily: ["Today's challenge. Same for everyone. Let's go!", "Daily Challenge time."],
  tour: ["The World Tour rolls on.", "Another stop on the World Tour."],
  "lucky-ball": ["Out comes the lucky ball...", "The lucky ball is back! The crowd knows it.", "{friend} kisses the lucky ball. Superstition? Absolutely."],
  "veteran-ball": ["A veteran ball. It's seen a few goals, this one.", "That ball has more goals than most strikers."],
  pack: ["A fresh pack! Let's see what's inside.", "New balls, new dreams."],
  showreel: ["Welcome to Penalty Kings!", "Easy to play, hard to master.", "Swipe, curl, dip, SCORE."],
  "intro:mouse": ["Squeak is tiny but lightning quick. Go high!", "The little mouse can't reach the top corners."],
  "intro:squirrel": ["Nibbles always goes early. Watch the lean!", "Too much coffee for this squirrel."],
  "intro:sloth": ["Snooze barely moves. Power beats him.", "Those arms are longer than they look."],
  "intro:peacock": ["Peacock Pete fans his tail to fake you out.", "Don't trust the feathers!"],
  "intro:octopus": ["Octavia covers a whole third. Pick another.", "Eight arms, well, four for goalkeeping."],
  "intro:mime": ["Marcel is building an invisible wall. Look for the shimmer!", "The mime says nothing. The wall says everything."],
  "intro:disco": ["Disco Dee dives on the beat.", "Listen to the music, {friend}!"],
  "intro:sumo": ["Big Bento fills the middle. Go for the corners.", "The ground shakes when Bento stomps."],
  "intro:chameleon": ["Chroma blends into the net. Trust your aim.", "Where's the keeper? Exactly."],
  "intro:robot": ["K-33P learns your favourite corner. Mix it up!", "The robot has been studying your penalties."],
  "intro:ghost": ["Boo can teleport. Spooky.", "The ghost keeper is here. Nobody's quite sure how."],
  "intro:finalwall": ["THE FINAL WALL. Three phases. One legend.", "Only the bravest shoot at THE FINAL WALL."],
};
export const COMMENTARY_COUNT = Object.values(LINES).reduce((n, list) => n + list.length, 0);
/** Every commentator line in the game: these contexts plus the Match Director's bank and keeper banter pairs. */
export const ALL_COMMENTARY_COUNT = COMMENTARY_COUNT + LINE_COUNT + BANTER_COUNT;
export const commentaryContexts = () => Object.keys(LINES);

/** Filled-in Match Director lines waiting to be said, by context key (bounded). */
const cued = new Map<string, string>();
/**
 * Hand a Match Director line to the Stage: `scene.say(cueLine(line))` shows exactly that text
 * (already filled in by the Director), so the Director's no-repeat window applies.
 */
export function cueLine(line: { id: string; text: string }): CommentaryContext {
  const key = `line:${line.id}` as const;
  cued.delete(key); cued.set(key, line.text);
  if (cued.size > 64) cued.delete(cued.keys().next().value!);
  return key;
}

const recent = new Map<string, number[]>();
/** A line for the context; cycles through the whole pool before repeating (shuffled order). */
export function commentary(context: CommentaryContext | string, names: { friend: string; keeper: string }) {
  if (context.startsWith("line:")) {
    const text = cued.get(context) ?? lineTemplate(context.slice(5));
    if (text) return text.replaceAll("{friend}", names.friend).replaceAll("{keeper}", names.keeper).replaceAll("{number}", names.friend.replace(/\D/g, "") || names.friend);
  }
  const list = LINES[context] ?? LINES.keeper;
  const used = recent.get(context) ?? [];
  const free = list.map((_, i) => i).filter(i => !used.includes(i));
  const pick = free[Math.floor(Math.random() * free.length)];
  recent.set(context, free.length === 1 ? [] : [...used, pick]);
  return list[pick].replaceAll("{friend}", names.friend).replaceAll("{keeper}", names.keeper);
}

/** Seconds within which the same line is never shown twice (owner's target: 0 repeats in 60 s). */
export const NO_REPEAT_SECONDS = 60;
const shownAt = new Map<string, number>();
const fill = (text: string, names: { friend: string; keeper: string }) => text.replaceAll("{friend}", names.friend).replaceAll("{keeper}", names.keeper).replaceAll("{number}", names.friend.replace(/\D/g, "") || names.friend);
/**
 * The line the Stage should show now, or null when every candidate was shown in the last 60 s
 * (silence beats a repeat). A Match Director line (`line:` context) is shown verbatim unless that exact
 * text was on screen within the window; a legacy context picks a line not shown within the window.
 * `now` is seconds on any monotonic clock (the Stage passes real time).
 */
export function freshCommentary(context: CommentaryContext | string, names: { friend: string; keeper: string }, now: number): string | null {
  const recent = (text: string) => { const at = shownAt.get(text); return at !== undefined && now - at < NO_REPEAT_SECONDS; };
  let text: string | null = null;
  if (context.startsWith("line:")) {
    const cue = cued.get(context) ?? lineTemplate(context.slice(5));
    if (cue) { const filled = fill(cue, names); text = recent(filled) ? null : filled; }
  }
  if (text === null && !context.startsWith("line:")) {
    const list = (LINES[context] ?? LINES.keeper).map(line => fill(line, names)).filter(line => !recent(line));
    if (list.length) text = list[Math.floor(Math.random() * list.length)];
  }
  if (text !== null) {
    shownAt.set(text, now);
    if (shownAt.size > 400) for (const [key, at] of shownAt) if (now - at >= NO_REPEAT_SECONDS) shownAt.delete(key);
  }
  return text;
}

/** Pixel portrait with mouth flap while talking. */
export function drawCommentator(c: CanvasRenderingContext2D, x: number, y: number, talking: boolean, time: number) {
  c.fillStyle = "#0b0d1a"; c.fillRect(x - 1, y - 1, 20, 20);
  c.fillStyle = "#2a6fdb"; c.fillRect(x, y, 18, 18);
  c.fillStyle = "#f2c79a"; c.fillRect(x + 4, y + 3, 10, 11);
  c.fillStyle = "#6b3e1f"; c.fillRect(x + 4, y + 2, 10, 3);
  c.fillStyle = "#111"; c.fillRect(x + 6, y + 7, 2, 2); c.fillRect(x + 10, y + 7, 2, 2);
  c.fillStyle = "#6b1f1f"; const open = talking && Math.floor(time * 12) % 2 === 0; c.fillRect(x + 7, y + 11, 4, open ? 2 : 1);
  c.fillStyle = "#111"; c.fillRect(x + 1, y + 6, 2, 6); c.fillRect(x + 2, y + 4, 1, 3); // headset
  c.fillStyle = "#ffffff"; c.fillRect(x + 4, y + 15, 10, 3);
}
