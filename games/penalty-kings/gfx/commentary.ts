/** The commentator ("Clive Crossbar", an original character): 40+ context-aware one-liners. */
export type CommentaryContext = "walkout" | "buildup" | "goal" | "save" | "post" | "over" | "wide" | "streak2" | "streak3" | "rarity-high" | "rarity-top" | "keeper" | "sudden-death" | "boss" | "wall" | "freekick" | "target" | "knuckle";

const LINES: Readonly<Record<CommentaryContext, string[]>> = {
  walkout: ["And here comes {friend}, cool as a cucumber.", "What an entrance from {friend}!", "The crowd rise for {friend}.", "{friend} steps out of the tunnel. Goosebumps."],
  buildup: ["The stadium holds its breath...", "Deep breaths now.", "{keeper} is bouncing on the line.", "You could hear a pin drop.", "This is the moment."],
  goal: ["GOOOAL! Top drawer!", "Absolutely buried it!", "No chance for {keeper}!", "Right in the onion bag!", "That's in the history books!", "Cool as you like!", "Get the net-mender on the phone!"],
  save: ["Saved! {keeper} says no!", "What a stop from {keeper}!", "Denied!", "{keeper} reads it all the way.", "Gloves of steel!", "That was always going to be saved."],
  post: ["OFF THE POST! Ooooh!", "Woodwork! The post is still shaking.", "Inches away!", "The frame of the goal saves {keeper}!"],
  over: ["Row Z! Somebody catch that!", "That's gone into orbit.", "A souvenir for the fans!", "Aim lower, friend."],
  wide: ["Wide! Just wide!", "Dragged it past the post.", "The corner flag had no chance."],
  streak2: ["{friend} is heating up!", "Two in a row. Feel the heat.", "Somebody stop {friend}!"],
  streak3: ["{friend} is ON FIRE!", "Unstoppable! Absolutely unstoppable!", "Hat-trick hero!"],
  "rarity-high": ["Ooh, a shiny ball!", "That ball's worth a closer look."],
  "rarity-top": ["A GOLDEN BOOT BALL! Hold everything!", "Gold! Pure gold!"],
  keeper: ["Facing {keeper} today.", "{keeper} has a reputation.", "Watch {keeper}'s feet."],
  "sudden-death": ["Sudden death. Double or nothing.", "One kick. Everything on the line."],
  boss: ["THE FINAL WALL rises...", "Nobody has ever beaten THE FINAL WALL twice."],
  wall: ["Straight into the wall!", "The wall stands firm!", "Charged down!", "Somebody's going to feel that one."],
  freekick: ["Free kick. Plenty of options here.", "Over the wall or round it?", "The wall is set. The ref steps back."],
  target: ["Pick your targets!", "Clock's ticking!"],
  knuckle: ["A knuckleball! It's moving all over the place!", "No spin, all chaos!"],
};
export const COMMENTARY_COUNT = Object.values(LINES).reduce((n, list) => n + list.length, 0);

let counter = 0;
export function commentary(context: CommentaryContext, names: { friend: string; keeper: string }) {
  const list = LINES[context];
  counter = (counter + 1 + Math.floor(Math.random() * 3)) % 997;
  return list[counter % list.length].replaceAll("{friend}", names.friend).replaceAll("{keeper}", names.keeper);
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
