/**
 * The Director's line bank: original one-liners for the commentator, tagged by context.
 * A context is a colon path, most specific first when picked (see commentator.ts):
 *   goal:<zone | post-in | bar-in | panenka | curler | knuckle | screamer>, goal:vs:<keeper>, save:by:<keeper>, tell:<keeper>,
 *   save / post / crossbar / over / wide / wall / near-miss, streak:<2|3|5>, cold,
 *   glow:<high|top>, first:<event>, time:<of day>, stadium:<id>, buildup, banter, moment:<moment id>.
 * Placeholders: {friend}, {keeper}, {number} (the Friend's token number).
 * Line ids are `<context>#<index>`; append new lines at the end of a list so saved ids stay valid.
 */
import type { KeeperId } from "./types.ts";

export const LINE_BANK: Readonly<Record<string, readonly string[]>> = {
  // ── Goals by type and zone ────────────────────────────────────────────────
  goal: ["And it's in! {friend} makes it look easy.", "Net rippling, crowd bouncing. Lovely.", "That's a goal, and a tidy one at that.", "{keeper} can only watch it go past.", "Sweetly struck, {friend}!", "In it goes. Nothing fancy, all business.", "The scoreboard operator earns his wages again.", "Goal! The home end are singing."],
  "goal:bin": ["Right up where the spiders live! Top bin!", "Stuck it in the very top corner. Frame that one.", "Upper ninety! {keeper} needed a ladder.", "That's gone in off the cobwebs. Top bin!", "Highest shelf in the shop!"],
  "goal:corner": ["Tucked into the corner. Textbook.", "Low and hard into the corner, just how the coaches draw it.", "Picked out the corner like a snooker pot.", "Corner of the net. {keeper} was a yard short."],
  "goal:side": ["Side-footed home with no fuss.", "Placed, not blasted. In it goes.", "Just inside the post and that's all it needed."],
  "goal:centre": ["Straight down the middle and it still goes in!", "Right through the middle. Bold.", "Hit it where the keeper was standing. Keeper wasn't there any more."],
  "goal:post-in": ["Off the upright and IN! The woodwork was on our side!", "Pinged the post and nestled in. Heart attack stuff.", "Post and in! Ask the post, it's still humming.", "Kissed the inside of the post. What a way to score."],
  "goal:bar-in": ["Off the underside of the bar and IN! The crossbar is on our side!", "Bar and in! That one rang round the stadium.", "Clattered the crossbar and dropped over the line. Magnificent!"],
  "goal:panenka": ["A chip down the middle! {friend} has ice for blood!", "The Panenka! Pure theatre!", "Floated in while {keeper} lay in the grass. Outrageous.", "The softest, cheekiest goal you'll see today."],
  "goal:curler": ["Whipped round the wall like a boomerang!", "The bend on that! It went round a corner!", "Curled it in with the outside of the boot. Show-off.", "That swung in like a pendulum!"],
  "goal:knuckle": ["That ball was dancing! Nobody could read it!", "No spin, all wobble, all goal!", "A knuckler! It changed its mind three times in the air!"],
  "goal:screamer": ["From all of THIRTY yards! What a SCREAMER!", "Hit from the next postcode and it still dipped in!", "A screamer! The net is asking for a lie-down.", "Long range, no fear, top drawer. Take a bow, {friend}!", "They'll be showing that one at Christmas. What a hit!"],
  // ── Keeper-specific: beaten and saves ───────────────────────────────────────
  "goal:vs:mouse": ["Squeak jumped as high as a mouse can. Not high enough."],
  "goal:vs:squirrel": ["Nibbles was gone before the ball was struck!"],
  "goal:vs:sloth": ["Snooze was still thinking about diving when it went in."],
  "goal:vs:peacock": ["All feathers and no fingertips from Peacock Pete!"],
  "goal:vs:octopus": ["Octavia covered her third. Shame it went in the other two."],
  "goal:vs:mime": ["Straight through a gap in Marcel's invisible wall!"],
  "goal:vs:disco": ["Disco Dee danced the wrong way. Off the beat!"],
  "goal:vs:sumo": ["Big Bento can't cover a corner. Nobody can at that size."],
  "goal:vs:chameleon": ["Chroma blended in so well she forgot to save it."],
  "goal:vs:robot": ["K-33P's database did not predict THAT."],
  "goal:vs:ghost": ["Boo appeared exactly where the ball wasn't!"],
  "goal:vs:finalwall": ["A crack in THE FINAL WALL! Did that really happen?!"],
  "save:by:mouse": ["Squeak! Tiny keeper, massive save!"],
  "save:by:squirrel": ["Nibbles guessed early and guessed right. Cheeky."],
  "save:by:sloth": ["Snooze didn't move. Just stuck out a very long arm."],
  "save:by:peacock": ["Peacock Pete saves and poses for the cameras."],
  "save:by:octopus": ["Four arms, one ball, no chance. Octavia!"],
  "save:by:mime": ["Blocked by a wall nobody could see!"],
  "save:by:disco": ["Right on the beat! Disco Dee boogies across and saves!"],
  "save:by:sumo": ["It hit Bento and simply stopped. Physics."],
  "save:by:chameleon": ["Chroma appears from nowhere to save it!"],
  "save:by:robot": ["K-33P logged that corner. Saved."],
  "save:by:ghost": ["Boo teleported into the path of it. Spooky save!"],
  "save:by:finalwall": ["THE FINAL WALL does not crack. Not today."],
  // ── Misses ─────────────────────────────────────────────────────────────────
  save: ["Kept out! Strong hands from {keeper}.", "Good height for the keeper, that one.", "{keeper} gets a glove to it and pushes it round.", "Parried away. The keeper's day so far.", "Saved, and the keeper lets everyone know about it.", "Read like a bedtime story. Saved."],
  post: ["Off the post! The whole goal wobbled.", "Upright says no! So cruel.", "The post gets in the way. Unlucky.", "Clattered the woodwork. Paint missing from that post."],
  crossbar: ["Off the crossbar! It's still vibrating!", "Thumped the bar. The ball came back quicker than it went.", "Bar! Half an inch lower..."],
  over: ["Over the bar and into the upper tier.", "Sailed high. The pigeons scattered.", "Launched it. Somebody's lunch just got interrupted.", "Too much on it. Up, up and away."],
  wide: ["Just the wrong side of the post.", "Pulled it wide. The advertising board took a beating.", "Whistling past the upright, but past it.", "Missed the target. The corner flag breathes again."],
  wall: ["Into the wall. Somebody's got a red mark on their forehead.", "Wall does its job. Brave lads.", "Smacked into the wall and away."],
  "near-miss": ["Grazed the paint on the way past!", "A whisker! A single whisker!", "Closer than a haircut, that one.", "The width of a bootlace! Agony!"],
  // ── Streaks and slumps ──────────────────────────────────────────────────────
  "streak:2": ["Two on the bounce for {friend}!", "Back to back and looking sharp.", "That's a pair. Can we make it three?"],
  "streak:3": ["Three in a row! Hat-trick of spot kicks!", "{friend} can't stop scoring!", "Three straight. The keepers' union is calling a meeting."],
  "streak:5": ["FIVE in a row! Is this a video game?", "Five straight! Somebody check {friend}'s boots!", "Five and counting. Historic stuff."],
  cold: ["Tough spell. One good strike changes everything.", "Reset, breathe, go again, {friend}.", "The goal hasn't moved. It'll come.", "Every striker has these days. Next one."],
  // ── Broad fallbacks (keep these pools deep: they guarantee the no-repeat window) ─────────
  cheer: ["What a moment for {friend}!", "The fans in the front row are hugging strangers.", "Put that one on the highlights reel.", "Pure joy in the stands.", "Oh, that's lovely. That's really lovely.", "The dugout are on their feet.", "You can't coach that. Well, you can, but still.", "That'll be on the replay screens all week.", "Somebody tell the groundsman the net needs checking.", "The mascot is doing cartwheels!", "Delightful. Absolutely delightful.", "They'll be talking about that one on the bus home.", "Arms up, badge out, crowd going wild.", "Well, I didn't see that coming. Neither did {keeper}.", "A finish with a bit of swagger."],
  miss: ["Not this time.", "So near, and yet...", "That one got away from {friend}.", "The keeper wins this round.", "Hands on heads all over the ground.", "A collective sigh from the stands.", "It happens to the best of them.", "Dust yourself down, {friend}.", "The crowd will forgive that one.", "Nope. Not today.", "One to forget. Quickly.", "Somewhere a coach is muttering.", "Back to the spot, try again.", "Close, but no confetti.", "You win some, you lose some."],
  // ── Ball glow (cosmetic read only) ─────────────────────────────────────────
  "glow:high": ["That ball is shimmering under the lights.", "Proper sparkle on the match ball today."],
  "glow:top": ["Look at the glow on that ball! You could read by it.", "That match ball is dazzling the front row."],
  // ── First-time events ──────────────────────────────────────────────────────
  "first:goal": ["{friend}'s first goal! Remember this one!", "The first of many, surely. Welcome to the scoresheet!"],
  "first:bin": ["First top bin for {friend}! Stick it on the fridge!", "A maiden top-corner finish! The owls are evicted!"],
  "first:panenka": ["First ever Panenka from {friend}! The nerve!"],
  "first:post-in": ["First goal in off the post! Lucky? Talented? Both."],
  "first:bar-in": ["First goal in off the bar! The crossbar has picked a side."],
  "first:knuckle": ["{friend}'s first knuckleball! It had a mind of its own!"],
  "first:curler": ["First curler round the wall! Bend it, {friend}!"],
  "first:screamer": ["{friend}'s first SCREAMER! From that far out? Outrageous!"],
  "first:beat": ["First time anyone's seen {friend} beat {keeper}!", "{keeper} beaten for the first time. That one's going in the scrapbook."],
  "first:save": ["First save against you, {friend}. Welcome to the big leagues."],
  // ── Time of day and stadium ─────────────────────────────────────────────────
  "time:morning": ["Early kick-off. Half the crowd are still holding croissants.", "Morning dew on the grass. The ball will skid.", "Breakfast football. My favourite kind."],
  "time:afternoon": ["Afternoon sun, full stands, perfect conditions.", "Lovely afternoon for it. Sun cream on, everyone.", "The afternoon crowd are in fine voice."],
  "time:evening": ["The evening shadows stretch across the box.", "Tea-time penalties. Nothing better.", "The lights are warming up as the sky goes orange."],
  "time:night": ["Under the lights now. Everything feels bigger at night.", "Late kick-off. The owls are watching the top bins nervously.", "Night football. The ball glows white against the dark."],
  "stadium:park": ["Sunday league rules down the park: jumpers optional.", "Somebody's dog is watching from behind the goal.", "The park pitch has more bumps than a country lane.", "Ice-cream van's playing its tune. Focus, {friend}!"],
  "stadium:pro": ["Floodlights, big crowd, big stage. This is the pros.", "The pro stadium is rocking tonight.", "Cameras everywhere. No hiding place at this level.", "The press box is full. They'll write about this."],
  "stadium:champions": ["The Golden Arena. Legends have stood on this spot.", "Gold trim everywhere. Even the goal nets sparkle.", "Champions level. The best of the best.", "They say the grass here is trimmed with scissors."],
  // ── Pressure and banter ─────────────────────────────────────────────────────
  buildup: ["Hush now. Big kick coming.", "Look at the concentration on {friend}.", "{keeper} is trying to get inside {friend}'s head.", "Placement or power? Decisions, decisions.", "The whole stand is leaning forward.", "Nerves? What nerves?"],
  banter: ["My co-commentator says he'd have scored that. He once missed a bus.", "Fun fact: the penalty spot is exactly where it was yesterday.", "I've had three cups of tea and I'm still not calm.", "Somebody in row F has brought a trumpet. Brave.", "The groundskeeper says he's never seen a pitch this happy.", "That's the fourth time the mascot has waved at me."],
  // ── Keeper tells (micro) ───────────────────────────────────────────────────
  "tell:mouse": ["Squeak can't reach the top. You know what to do."],
  "tell:squirrel": ["Watch Nibbles' lean. He always gives it away."],
  "tell:sloth": ["Snooze won't dive far. Hit it with pace."],
  "tell:peacock": ["The tail is a fib. Go the other way from the feathers."],
  "tell:octopus": ["Octavia's chosen her third. Pick another."],
  "tell:mime": ["Look for the shimmer. That's where the wall is."],
  "tell:disco": ["Count the beat. Disco Dee dives on it."],
  "tell:sumo": ["Big Bento owns the middle. Corners, corners."],
  "tell:chameleon": ["You won't see Chroma. Trust your aim."],
  "tell:robot": ["K-33P has learned your favourite side. Change it."],
  "tell:ghost": ["If Boo flickers, he's read you. Switch late."],
  "tell:finalwall": ["Three phases. Middle first, then it reads you, then everything."],
  // ── Moments (one context per moment id) ────────────────────────────────────
  "moment:crowd-hush": ["Listen to that. Forty thousand people, no noise.", "The stadium goes quiet. You can hear the flags."],
  "moment:keeper-taunt": ["{keeper} is chirping from the goal line.", "{keeper} has plenty to say, as usual."],
  "moment:keeper-tell": ["Watch the keeper closely here."],
  "moment:shot-clock": ["Tick, tock, {friend}.", "The shot clock is running."],
  "moment:drumbeat": ["The drummer in the away end sets the rhythm."],
  "moment:ref-whistle": ["The ref points at the spot. Ready when you are."],
  "moment:commentator-banter": ["Right, while we wait..."],
  "moment:vuvuzela": ["And there's that trumpet again. Somebody confiscate it."],
  "moment:jumbotron-fact": ["The big screen has a fun fact for us."],
  "moment:ball-glow": ["Take a look at that match ball."],
  "moment:keeper-stretch": ["{keeper} is stretching. Hamstrings, groin, dignity."],
  "moment:crowd-roar": ["Hear that roar!"],
  "moment:crowd-ooh": ["Ooooooh! The whole stadium said it together."],
  "moment:crowd-groan": ["A groan rolls round the stands."],
  "moment:keeper-gloat": ["{keeper} is loving this."],
  "moment:streak-chant": ["They're singing {friend}'s name now!"],
  "moment:fan-catch": ["Great catch in the stands! Give that fan a contract!"],
  "moment:ball-kid": ["The ball kid sprints after it. Olympic pace."],
  "moment:scarf-twirl": ["Scarves spinning all round the ground."],
  "moment:air-horn": ["Somebody's found an air horn. Of course they have."],
  "moment:slow-clap": ["A slow clap for the keeper. Respect."],
  "moment:chin-up": ["The crowd are right behind {friend}. Hear them?"],
  "moment:photo-flash": ["The photographers' bulbs are popping behind the goal!"],
  "moment:keeper-sub": ["A change in goal! {keeper} jogs on to take the gloves.", "New keeper! {keeper} walks on to a big cheer."],
  "moment:weather-rain": ["Here comes the rain. Umbrellas up in the posh seats.", "A downpour rolls in over the stand. Slippery!"],
  "moment:weather-snow": ["Is that... snow? It's snowing!", "Snowflakes drifting down. Somebody fetch the orange ball."],
  "moment:weather-fog": ["A fog bank is creeping across the pitch.", "The fog's rolling in. I can see about half a keeper."],
  "moment:weather-clear": ["And the skies clear! Lovely.", "The weather's lifted. Perfect again."],
  "moment:cat-invader": ["There's a cat on the pitch! Nobody panic!", "A pitch invader! Four legs, one tail, zero interest in football."],
  "moment:mexican-wave": ["Round it goes! The Mexican wave is on!", "The wave has lapped the stadium twice now!"],
  "moment:jumbotron-replay": ["Let's see that again on the big screen.", "Replay on the jumbotron. Still gorgeous second time round."],
  "moment:kiss-cam": ["Kiss Cam! Oh, they're shy. Oh no, they're not!", "The Kiss Cam finds a couple in row K. Awww."],
  "moment:var-check": ["Hold on, VAR are having a look...", "VAR check! Was that in? Everybody hold your breath."],
  "moment:mascot-race": ["Half-time mascot race! My money's on the giant sock.", "The mascots are off! The chicken is cheating!"],
  "moment:fireworks": ["Fireworks! They're lighting up the sky for {friend}!", "Somebody lit the fireworks early! What a streak!"],
  "moment:beach-ball": ["A beach ball bouncing round the stands. Security are powerless."],
  "moment:pigeon": ["A pigeon has landed on the crossbar. It looks settled."],
  "moment:floodlight-flicker": ["The floodlights flicker... and they're back. Phew."],
  "moment:conga": ["There's a conga line in the family stand!"],
  "moment:tifo": ["Look at that banner unrolling down the stand! Magnificent."],
  "moment:drone-cam": ["The drone camera swoops over the goal. Very fancy."],
  "moment:brass-band": ["The brass band strikes up. Toes are tapping."],
  "moment:ref-cards": ["The ref's dropped his cards. The crowd cheer ironically."],
  "moment:rainbow": ["A rainbow over the stadium! Somebody make a wish."],
  "moment:keeper-mind-games": ["{keeper} is pointing at a corner. Bluff or double bluff?"],
  "moment:sprinklers": ["The sprinklers have come on! Everyone's soaked!"],
  "moment:selfie-cam": ["Selfie Cam on the big screen! Best pose wins a pie."],
  "moment:boss-appearance": ["The ground trembles... THE FINAL WALL is here!", "Lights dim. A shadow fills the goal. It's THE FINAL WALL."],
  "moment:golden-hour": ["Golden Hour! The sun drops and every skill point counts double!", "The sky turns gold. Golden Hour is on: double skill points!"],
  "moment:lights-out": ["Lights out. One spotlight. One kick.", "They've killed the floodlights. It's just {friend} and the spot."],
  "moment:friend-chant": ["Hear them? NUMBER {number}! NUMBER {number}!", "The whole ground is chanting {number}!"],
  "moment:walkout": ["Here's {friend}, strolling out to a hero's welcome."],
  "moment:card-mosaic": ["The crowd hold up their cards... it's a giant boot!", "A card mosaic across the whole stand. Beautiful."],
  "moment:anthem": ["The stadium anthem! Forty thousand voices, one tune."],
  "moment:trophy-lap": ["They've brought the trophy out to watch. No pressure!"],
  "moment:midnight-fireworks": ["Midnight fireworks! The sky's exploding with colour!"],
  "moment:legend-in-stands": ["There's a legend in the stands tonight! No autographs until full time."],
  "moment:duel-cam": ["Split screen: {friend} on the left, {keeper} on the right. Showdown."],
  "moment:thunderstorm": ["Thunder rumbles over the stadium. Dramatic stuff!"],
};

/** Keeper banter pairs: the commentator sets it up, the keeper answers. */
export const BANTER: Readonly<Record<KeeperId, readonly (readonly [string, string])[]>> = {
  mouse: [["They say Squeak trains by jumping for cheese on high shelves.", "Still can't reach it. Don't tell anyone."], ["Squeak's gloves are the size of teabags.", "Small gloves. Big heart!"]],
  squirrel: [["Nibbles has had four espressos, I'm told.", "Five! FIVE! Let's GO!"], ["Nibbles buried an acorn behind the goal at half-time.", "It's for later. Mind your business."]],
  sloth: [["Snooze was asked for a pre-match interview. He's still answering.", "...the... first... question..."], ["Snooze's warm-up is a lie-down.", "Resting is training."]],
  peacock: [["Peacock Pete has changed his kit three times today.", "The camera loves me. Deal with it."], ["Pete's tail feathers have their own fan club.", "Autographs after the save, darlings."]],
  octopus: [["Octavia holds the record for most catches in one training session.", "Also most sandwiches held at once."], ["They say you can't beat Octavia in her third.", "They say correctly."]],
  mime: [["Marcel has been asked for his thoughts on the match.", "(pretends to think very hard)"], ["Marcel is now pulling an invisible rope.", "(the rope is attached to your confidence)"]],
  disco: [["Disco Dee brought a mirrorball to the dressing room.", "Every day is Saturday night, baby!"], ["Dee's playlist today is ninety minutes of funk.", "Feel it in your gloves!"]],
  sumo: [["Bento eats eleven breakfasts on matchday.", "Twelve. The last one was small."], ["The groundsman has reinforced the goal line for Bento.", "HOOAH! It will not be enough!"]],
  chameleon: [["Chroma has been standing next to me for ten minutes. I had no idea.", "Surprise. I heard everything."], ["Chroma's kit is whatever colour the net is today.", "Fashion is camouflage."]],
  robot: [["K-33P has downloaded every penalty ever taken.", "PROBABILITY OF SAVE: VERY HIGH. BEEP."], ["K-33P's software update finished just before kick-off.", "NEW FEATURE: SMUGNESS."]],
  ghost: [["Boo's shirt has no number because nobody has seen his back.", "Boooo. I'm already behind you."], ["Boo walked through the dressing room wall this morning.", "Doors are for the living."]],
  finalwall: [["THE FINAL WALL arrived in a lorry. Several lorries.", "YOU. SHALL. NOT. SCORE."], ["Nobody knows what THE FINAL WALL eats. Hope it's not strikers.", "BRICKS. AND DOUBT."]],
};

export const LINE_COUNT = Object.values(LINE_BANK).reduce((n, list) => n + list.length, 0);
export const BANTER_COUNT = Object.values(BANTER).reduce((n, list) => n + list.length, 0);

/** Look a line up by its id (`<context>#<index>` or `banter:<keeper>#<pair>:<0|1>`). */
export function lineTemplate(id: string): string | null {
  const banter = /^banter:([a-z]+)#(\d+):([01])$/.exec(id);
  if (banter) return BANTER[banter[1] as KeeperId]?.[Number(banter[2])]?.[Number(banter[3])] ?? null;
  const hash = id.lastIndexOf("#");
  if (hash < 0) return null;
  return LINE_BANK[id.slice(0, hash)]?.[Number(id.slice(hash + 1))] ?? null;
}

export const fillLine = (text: string, names: { friend: string; keeper: string; number: string }) =>
  text.replaceAll("{friend}", names.friend).replaceAll("{keeper}", names.keeper).replaceAll("{number}", names.number);
