import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHAMPIONS_NIGHT, NIGHT_RACE_MULTIPLIER, championsNight, isChampionsNight, racePointMultiplier, shortCountdown, championsNightLine,
  cupDrawLine, stadiumRaceLine, STADIUM_RACE_RULE, lastWeekWinners, cupEntriesLine, countUpValue, SIM_TRICKLE_MS,
} from "../../games/penalty-kings/game/weekly.ts";
import { cupEndsAt } from "../../games/penalty-kings/game/prizes.ts";
import { TIERS, CUP_CURVE, SIM_CUP_SEED_RF, STADIUM_MESSAGE } from "../../games/penalty-kings/economy.ts";
import { commentary, commentaryContexts } from "../../games/penalty-kings/gfx/commentary.ts";

// C3b Champions Night + C3c the weekly Cup clock. All times are UTC (Date.UTC), so no DST can move a window.
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h, mi, s, ms);
const H = 3_600_000, WEEK = 7 * 24 * H;

test("Champions Night: Saturday 19:00-21:00 UTC, a fixed constant", () => {
  assert.deepEqual({ ...CHAMPIONS_NIGHT }, { weekday: 6, startHourUTC: 19, hours: 2 });
  assert.equal(new Date(at(2026, 10, 3)).getUTCDay(), 6, "2026-10-03 is a Saturday");
  assert.equal(isChampionsNight(at(2026, 10, 3, 18, 59, 59, 999)), false, "one ms before the start");
  assert.equal(isChampionsNight(at(2026, 10, 3, 19)), true, "starts at 19:00:00.000");
  assert.equal(isChampionsNight(at(2026, 10, 3, 20, 59, 59, 999)), true, "last ms of the window");
  assert.equal(isChampionsNight(at(2026, 10, 3, 21)), false, "ends at 21:00 (exclusive)");
  for (const day of [4, 5, 6, 7, 8, 9]) assert.equal(isChampionsNight(at(2026, 10, day, 19, 30)), false, `not on day ${day} (${new Date(at(2026, 10, day)).getUTCDay()})`);
  assert.equal(racePointMultiplier(at(2026, 10, 3, 20)), NIGHT_RACE_MULTIPLIER);
  assert.equal(NIGHT_RACE_MULTIPLIER, 2);
  assert.equal(racePointMultiplier(at(2026, 10, 3, 21)), 1);
});

test("Champions Night: the next window across week, month and year boundaries (UTC: DST never moves it)", () => {
  const during = championsNight(at(2026, 10, 3, 19, 48));
  assert.deepEqual(during, { active: true, startsAt: at(2026, 10, 3, 19), endsAt: at(2026, 10, 3, 21) });
  assert.equal(championsNight(at(2026, 10, 3, 21)).startsAt, at(2026, 10, 10, 19), "just after: next Saturday");
  assert.equal(championsNight(at(2026, 10, 3, 12)).startsAt, at(2026, 10, 3, 19), "Saturday morning: tonight");
  assert.equal(championsNight(at(2026, 9, 27, 19, 30)).startsAt, at(2026, 10, 3, 19), "Sunday: the coming Saturday");
  assert.equal(championsNight(at(2026, 10, 26, 0, 30)).startsAt, at(2026, 10, 31, 19), "month boundary (and the week after EU clocks change)");
  assert.equal(championsNight(at(2026, 10, 24, 19, 30)).startsAt, at(2026, 10, 24, 19), "the Saturday before EU clocks change: still 19:00 UTC");
  assert.equal(championsNight(at(2026, 12, 31, 22)).startsAt, at(2027, 1, 2, 19), "year boundary");
  // Every window is exactly one week after the last, for a whole year.
  let start = championsNight(at(2026, 1, 1)).startsAt;
  for (let week = 0; week < 53; week++) {
    const next = championsNight(start + 2 * H).startsAt;
    assert.equal(next - start, WEEK, `week ${week}`); assert.equal(new Date(next).getUTCHours(), 19); assert.equal(new Date(next).getUTCDay(), 6);
    start = next;
  }
});

test("countdown lines: 'Champions Night in 1d 3h', 'CHAMPIONS NIGHT · double Cup points · ends in 1h 12m', 'Cup draw in 2d 4h'", () => {
  assert.equal(shortCountdown(27 * H), "1d 3h");
  assert.equal(shortCountdown(72 * 60_000), "1h 12m");
  assert.equal(shortCountdown(7 * 60_000), "7m");
  assert.equal(shortCountdown(1), "1m", "a running window never reads 0m");
  assert.equal(shortCountdown(-5), "0m");
  assert.equal(championsNightLine(at(2026, 10, 2, 16), true), "Champions Night in 1d 3h");
  assert.equal(championsNightLine(at(2026, 10, 3, 19, 48), true), "CHAMPIONS NIGHT · double Cup points · ends in 1h 12m");
  assert.equal(championsNightLine(at(2026, 10, 3, 19, 48), false), "CHAMPIONS NIGHT · golden stadium · ends in 1h 12m", "live stadiums never claim a doubling they do not apply");
  // The weekly Cup draw: Monday 00:00 UTC (prizes.ts cupEndsAt).
  assert.equal(cupEndsAt(at(2026, 10, 3, 20)), at(2026, 10, 5));
  assert.equal(cupDrawLine(at(2026, 10, 2, 20)), "Cup draw in 2d 4h");
  assert.equal(cupDrawLine(at(2026, 10, 5)), "Cup draw in 7d 0h", "exactly at the draw: the next week's");
});

test("stadium cards: bigger stadium, more Cup points per ball (1 / 100 / 1,000), doubled on Champions Night; one shared Cup", () => {
  const [park, pro, champions] = TIERS;
  assert.deepEqual(TIERS.map(tier => tier.raceWeight), [1, 100, 1000]);
  const day = at(2026, 10, 1, 12), night = at(2026, 10, 3, 20);
  assert.equal(stadiumRaceLine(park, day), "Cup points ×1 per ball");
  assert.equal(stadiumRaceLine(pro, day), "Cup points ×100 per ball");
  assert.equal(stadiumRaceLine(champions, day), "Cup points ×1,000 per ball");
  assert.equal(stadiumRaceLine(champions, night), "Cup points ×2,000 per ball tonight");
  assert.match(STADIUM_RACE_RULE, /Park ×1, Pro ×100, Champions ×1,000/);
  assert.match(STADIUM_RACE_RULE, /same Golden Boot Cup/);
  assert.equal(STADIUM_RACE_RULE.split(/[.!?](\s|$)/).filter(part => part && part.trim()).length, 1, "one sentence");
});

test("the Ball shop's stadium message matches the host page listener (scripts/build-site.mjs)", () => {
  const site = readFileSync(new URL("../../scripts/build-site.mjs", import.meta.url), "utf8");
  assert.ok(site.includes(`const STADIUM_MESSAGE = ${JSON.stringify(STADIUM_MESSAGE)};`), "build-site listens for the same message type");
  assert.match(site, /frame\.contentWindow===event\.source/, "only a frame on the page may ask");
  assert.match(site, /Object\.hasOwn\(pages,data\.stadium\)/, "only a known stadium page is opened");
});

test("last week's winners: SIMULATED, generic Friend numbers, the published curve, stable for the week", () => {
  const monday = at(2026, 9, 28, 0, 0, 1), sunday = at(2026, 10, 4, 23, 59);
  const winners = lastWeekWinners(monday);
  assert.equal(winners.length, 5);
  assert.deepEqual(lastWeekWinners(sunday), winners, "the same all week");
  assert.notDeepEqual(lastWeekWinners(sunday + 2 * 60_000), winners, "a new week, new winners");
  winners.forEach((winner, index) => {
    assert.match(winner.name, /^Friend #\d{4}$/, "a generic Friend number, never a real name");
    assert.equal(winner.rank, index + 1);
    assert.equal(winner.amountRF, Math.round(SIM_CUP_SEED_RF * CUP_CURVE[index] / 100));
    assert.ok(winner.badge >= 0 && winner.badge < 6);
  });
  assert.equal(new Set(winners.map(winner => winner.name)).size, 5, "no duplicates");
});

test("Results: your Cup entries this week (preview) or omitted (live)", () => {
  assert.equal(cupEntriesLine(1200, 3, true), "Your Cup entries this week: 1,200 · your rank ~#3");
  assert.equal(cupEntriesLine(0, 12, true), "Your Cup entries this week: 0 · pull a Gold or Golden Boot ball to enter");
  assert.equal(cupEntriesLine(1200, 3, false), null, "live: the shell does not know the on-chain race, so it says nothing");
});

test("pot count-up: eases from the old value to the new one, never past it", () => {
  assert.equal(countUpValue(500_000, 500_027, 0), 500_000);
  assert.equal(countUpValue(500_000, 500_027, 1), 500_027);
  assert.equal(countUpValue(500_000, 500_027, 2), 500_027, "clamped");
  const mid = countUpValue(0, 100, 0.5);
  assert.ok(mid > 50 && mid < 100, "ease-out: past halfway at half time");
  let last = -1;
  for (let k = 0; k <= 1; k += 0.05) { const value = countUpValue(0, 100, k); assert.ok(value >= last); last = value; }
  assert.ok(SIM_TRICKLE_MS >= 10_000, "the simulated pot ticks slowly");
});

test("Champions Night has its own commentator intro", () => {
  assert.ok(commentaryContexts().includes("champions-night"));
  assert.match(commentary("champions-night", { friend: "Friend #7", keeper: "K" }), /Champions Night|CHAMPIONS NIGHT/);
});
