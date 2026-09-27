# Saving progress (round 6 B6)

## The gap

The FriendSDK runs the game in an iframe sandboxed with `allow-scripts` only. There is no `allow-same-origin`, so the game gets an opaque origin and `localStorage`, `sessionStorage`, IndexedDB and cookies all throw. Every reload of the judged preview therefore starts from zero XP, stars and stamps. The Daily Challenge's "3 attempts per day" also cannot be enforced there.

We did not try to work around the sandbox; its isolation is deliberate.

## Options evaluated

| Option | What it can keep | Verdict |
|---|---|---|
| **(a) Derive from on-chain data** | Balls held (the Bag re-syncs with `snapshot.inventory`), settles, redeems | **Used** for everything economic. It cannot hold XP, stars or stamps: those are off-chain skill progression. |
| **(b) Save code** (`game/savecode.ts`) | XP, stars, stamps, bests, unlocked cosmetics, the daily record | **Used** in the preview. Settings shows a code bound to your Friend with a checksum against typos; paste it back to restore. It is **not a signature**: a key shipped in client code cannot sign, so a player could edit their own progression. That only affects cosmetic progress, never money. |
| **(c) Trusted page outside the sandbox** (`/app/`) | Everything, against the logged-in wallet (signed messages to the referee Worker/KV, or on-chain checkpoints) | **Planned** (the onboarding app, R6-APP-f). It fixes persistence for app users, and it is where an enforceable Daily limit belongs. |

## Daily limit: honest wording

When the browser cannot persist (`canPersist()` is false, as in the SDK preview), the Daily card says **"Practice attempts left"**. It also explains that the limit resets on reload. The limit is only presented as a real limit where it can be kept.

## Request to Rare Friends (draft)

> **FriendSDK feature request: a small per-Friend save API.**
> Games in the SDK sandbox cannot keep any state between sessions, so levels, stars and streaks reset on reload. Could the runtime expose something like `client.storage.get(key)` / `client.storage.set(key, value)`?
> - Scoped to (game id, Friend id), with a few KB per Friend.
> - Stored by the host (for example, signed by the connected wallet and kept by Rare Friends, or on-chain for games that want it).
>
> It would never hold money; it is for progression only. This would let every SDK game keep progress without weakening the sandbox.
