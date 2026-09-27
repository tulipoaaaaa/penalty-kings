# Action-flow audit (bug round 3)

**What it is.** `games/penalty-kings/game/flow.ts` is the game's action-flow state machine: which actions are legal in which UI state. The shell (`index.tsx`) asks `allowed()` before every action, so these guards ARE the rules.

**How it is tested.**
- `tests/game/flow.test.ts` tries every action (19) in every state (≈69,000 combinations). It also fuzzes 400 seeded action sequences and checks the invariants: at most one kick in flight, every kick resolves exactly once, and the shot clock runs only while you can shoot.
- `scripts/test-flow.mjs` (`npm run test:flow`, in CI) plays 12 awkward interleavings in the real sandboxed runtime at 960 px and 360 px.

## Bugs found and fixed

| # | Bug | Cause | Fix |
|---|---|---|---|
| 1 | **Double shot.** A swipe release, Quick shot and Space in the same instant could record two kicks. The shot-clock timeout could also fire twice before React re-rendered. | The phase guard read React state, which only updates on re-render. | `setPhaseNow()` updates the guard synchronously, and an in-flight counter plus kick id guard every kick. |
| 2 | **Shot clock ran while a menu, pack, carousel or the SDK pause was open.** Closing the menu after 5 s gave an instant "TIME!". The Target Practice timer had the same bug. | The clocks used wall time (`performance.now()`). | A game clock (`clockNow()`) that is frozen while the game is paused, hidden, in a menu, pack or carousel, or during the walkout. |
| 3 | **Shooting during a pack reveal.** The pack opens over a running session, which was still in the aim phase. | The shoot guards did not know about the pack overlay. | `canShoot` requires no pack, carousel or menu; Quick shot is hidden then. |
| 4 | **Shooting during the keeper walkout** cut the walkout short. | No guard for Stage moments. | `Stage.moment` (walkout or reveal) blocks shots and freezes the clock. |
| 5 | **Keyboard and mouse together.** A pointer swipe could start while Space was charging, giving two shots. | No single-gesture rule. | A pointer swipe cannot start while Space charges, and vice versa. |
| 6 | **A second finger hijacked the swipe** (multi-touch, or mouse and touch together). | `pointerdown` reset the gesture for any pointer. | The first pointer owns the gesture; other pointer ids are ignored; lost capture drops the gesture. |
| 7 | **Resize or rotate mid-swipe** mixed two display scales into one gesture, giving a garbage shot. | Points were converted with each event's current rect. | Window resize and orientation change drop the gesture (no shot). |
| 8 | **Mode switch mid-kick.** The pot banner opened a menu during the kick. A cancelled kick's Stage events or timeout timer could then score into the next session. | The pot was not disabled mid-kick, and there was no kick cancellation. | The pot is disabled mid-kick. `Stage.cancel()` plus `cancelKick()` on every new session or "Change mode"; stale timers check the kick id. |
| 9 | **Kicking a redeemed ball.** Redeeming the ball you were aiming with, via Menu → Bag, left the aim active. | Redeem did not touch the session. | Redeeming the active ball cancels that aim and returns to "Choose ball". |
| 10 | **Carousel over an in-flight kick.** | The guard checked the phase only. | Found by the exhaustive test: the guard also checks for a kick in flight. |
| 11 | **`setPointerCapture` could throw** for a pointer that had already gone. | Unguarded call. | Wrapped in try/catch; capture is taken only after the pitch-area check. |

**Covered by the model but not by the browser test:** the SDK runtime pause, because the test harness has no pause control. The shell reads the same `paused` flag the model does.
