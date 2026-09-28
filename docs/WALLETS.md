# Wallets in the onboarding app (R6-APP-e / GR-3): what the SDK accepts

This is verified against FriendSDK v0.1.2 docs and types (`node_modules/@rarefriends/friendsdk/API.md`, `HOST_INTEGRATION.md`, `dist/game-host.d.ts`, `dist/wallet.d.ts`). A browser run with a real embedded wallet is still to be done once the provider app ID exists.

## What the SDK supports today

| Path | SDK surface | Works with an embedded wallet? |
|---|---|---|
| **(a) Pass a provider in** | `GameHost({ walletProvider })`: "reuse a browser provider"; `createFriendWalletSession({ provider })` ("supplying it disables discovery of other wallets") | **Yes by API.** Privy's and Dynamic's embedded wallets expose an EIP-1193 provider (`request` / `on` / `removeListener`), which is exactly `FriendWalletProvider`. |
| **(a′) Announce it via EIP-6963** | `createFriendWalletSession()` discovers EIP-6963 wallets | **Yes by API.** An embedded provider announced with `eip6963:announceProvider` appears in the SDK's wallet list. |
| **(b) Injected wallet only** | The default `GameHost` (EIP-6963 + `window.ethereum`) | **Yes** (today's behaviour). |
| **Connection already managed by the app** | `ConnectedGameHost({ account, chainId, publicClient, selectedFriend, walletClient?, revision })` | **Yes.** Build `walletClient` with viem `createWalletClient({ transport: custom(embeddedProvider) })`, and bump `revision` on account/chain change. |

**Unchanged in every path:** the sandbox (`allow-scripts` only), the bridge, and the fresh ownership gate (owner, generation ≥ 1, canonical wallet at one block). The provider never enters the game frame.

## The canonical-wallet rule and gasless play

In live mode the Friend's **canonical wallet is its token-bound account (TBA)**. The connected **owner** signs `execute` on it, and the TBA approves and spends RF and receives redemptions. So the address that **owns the NFT** must be the one that signs.

- **EIP-7702 (recommended):** the embedded EOA keeps its address and delegates to sponsored-execution code, so the paymaster pays gas. Ownership, the TBA and the SDK's `eth_sendTransaction` flow are all unchanged.
- **ERC-4337 smart account:** this also works only if the **smart account itself owns the Friend** (the hardwire and purchases are done from it). A Friend owned by the underlying EOA would fail the owner check. It also needs the SDK's `walletClient` writes to be routed as UserOperations. **Question for Rare Friends:** is a smart-account owner supported by the ownership gate and TBA `execute`?
- **RNG fee:** each Dice request costs ≤ 0.000025 ETH plus gas. Rare Friends states it plans to subsidise RNG for all developers; until then the paymaster budget must cover it.

## The adapter we build (`app/`, outside the judged preview)

`WalletAdapter = { kind: "embedded" | "injected"; provider: EIP1193; account; chainId; revision }`:
- **embedded:** the Privy/Dynamic provider is passed to `GameHost({ walletProvider })`, or announced via EIP-6963;
- **injected:** the default `GameHost` discovery.

The adapter is covered by the same browser tests with a mocked provider. The real provider IDs are human gates: the owner creates the accounts.

## Founder questions this answers or raises

- **Embedded wallets in the SDK:** supported by the API through `walletProvider` or EIP-6963. It needs a real-device test.
- **Auto-hardwire from smart wallets:** depends on smart-account ownership support (above).
- **Guest practice:** it must live outside the SDK game, because the SDK requires a hardwired Friend even for previews.

---

# Test app wallet seam (owner's test lane, branch `app/test-shell`)

The test app (`apps/mobile/web/`, built by `npm run build:test-app` into `dist-test-app/`) is **not** the judged build: it never writes `site/`, and `games/penalty-kings/**` is compiled read-only. Every screen shows **TEST BUILD · SIMULATED**. App id `com.penaltykings.test`, name "Penalty Kings (Test)".

## The interface (`packages/wallet/src/types.ts`)

```ts
interface WalletProvider {
  readonly kind: "dev-simulated" | "privy" | "injected";
  readonly label: string;
  login(method: "email" | "google" | "injected", opts?: { email?; getCode?: () => Promise<string>; onProgress? }): Promise<Hex>;
  logout(): Promise<void>;
  getAddress(): Hex | null;
  getBalance(): Promise<{ rf: bigint; simulated: boolean }>;
  getFriends(): Promise<FriendRef[]>;
  signMessage(message: string): Promise<Hex>;
  sendTransaction(tx: { to; data?; value?; label? }): Promise<{ hash; simulated; explorerUrl? }>;
  buyRF(amountUsd: number): Promise<{ rf: bigint; tx }>;
  onChange(cb: (snapshot) => void): () => void;   // returns unsubscribe
  snapshot(): WalletSnapshot;
  identityClient(): IdentityReadClient;             // the SDK ownership gate's reads (viem PublicClient subset)
}
```

Errors are `WalletError` with a code: `declined`, `rejected`, `offline`, `cancelled`, `bad-code`, `not-logged-in`, `blocked`, `unsupported`, `no-wallet`, `wrong-network`, `misconfigured`. The UI shows each with **Retry**.

The game is hosted by the SDK's own **`ConnectedGameHost`** (HOST_INTEGRATION.md, "When wallet and Friend context already exists"): the app passes `account = getAddress()`, `chainId = 4663`, `selectedFriend` and `publicClient = identityClient()`. The SDK still runs its fresh ownership gate (`readGenerationEligibility`), its sandbox (`allow-scripts` only) and its in-frame confirmations. No deployment is passed, so the in-game economy is always the SDK's simulated preview ledger.

## The three providers

| | DevSimulatedProvider (default) | PrivyProvider | InjectedProvider |
|---|---|---|---|
| Enabled by | default (`WALLET=dev`) | `WALLET=privy` **and** `PRIVY_APP_ID` at build time; otherwise falls back to DevSimulated with a red banner | `WALLET=injected`, or the dev menu |
| Login | email (any 6-digit code) / Google, both simulated | Privy email one-time code; Google OAuth (redirect, `privy_oauth_code`/`privy_oauth_state` on return) | `eth_requestAccounts` + switch/add Robinhood Chain 4663 |
| Address | deterministic `keccak256("penalty-kings-test-account:<account id>")`, **no key exists** | Privy embedded wallet (created on first login) | the browser wallet's account |
| Sign | fake, deterministic, flagged SIMULATED | `personal_sign` via Privy's EIP-1193 provider | `personal_sign` |
| Send tx | fake hash `keccak256("SIMULATED:…")`, `simulated: true` | `eth_sendTransaction` — **blocked in the test app** (`allowTransactions` false) | same, blocked |
| RF top-up, Friend loan, hardwire | simulated (SimEconomy) | simulated (SimEconomy, keyed by the real address) | simulated |
| Owned Friends | simulated | SDK `readOwnedFriends` on Robinhood (read-only) + simulated | same |
| SDK | none | `@privy-io/js-sdk-core` **0.76.2** (pinned, devDependency, loaded as a separate chunk only when used). Headless: the UI is ours, no Privy modal or branding | FriendSDK v0.1.2 `FriendWalletProvider` shape (EIP-1193) |

Chain config (`packages/wallet/src/chain.ts`) reuses what the repo already had: RPC `https://rpc.mainnet.chain.robinhood.com` (game `price.ts`, `scripts/onchain/lib.mjs`), explorer `https://robinhoodchain.blockscout.com` (`scripts/build-clubhouse.mjs`), Generations `0x14C4…181D` (SDK manifest).

`PRIVY_APP_ID` is a public id, read from the environment at build time, never committed; there is no Privy secret anywhere in the client.

`npm install` note: Privy 0.76.2 pins `viem 2.56.0` as an optional peer; `package.json` `overrides` points it at the repo's `viem` (2.56.9, same minor) and `permissionless`'s optional `ox` peer at viem's `ox`. `npm ci` resolves cleanly; the judged build does not import the package.

## Selection and the dev menu

`packages/wallet/src/config.ts`: the build flag picks the default; in test builds a hidden **dev menu** (tap the version number 5 times, on any onboarding screen or in Settings) switches provider at runtime (stored per device) and drives the **failure injector**: `declined` (payments), `rejected` (signatures/transactions), `offline`, `cancelled`, for the next matching step or "always"; plus "Reset test account".

## What is simulated

| Thing | Test app | Real app (later) |
|---|---|---|
| Login | simulated (DevSimulated) / real Privy (privy build) | Privy or the founders' SDK |
| Wallet address | derived, keyless (DevSimulated) | embedded wallet |
| Buying RF ($5/$20/$50) | **simulated sheet** in our pixel style: "Simulated payment (test)", "In the real app, <provider> will handle this step." Converted with the game's **recorded on-chain snapshot price** (`games/penalty-kings/game/price.ts`, block 73,949,883), labelled as a snapshot | on-ramp / store purchase |
| Friend | the SDK **fixture Friend #7730** (recorded canonical art shipped with FriendSDK), "loaned" or "owned", simulated | a real hardwired Generations NFT |
| Hardwire | fake transaction with progress, hash labelled SIMULATED | on rarefriends.com |
| Ownership gate | the SDK's real `readGenerationEligibility`, answered by the simulated identity client | Robinhood Chain |
| Game economy (packs, Bag, redeem) | the SDK preview ledger, starting at the test wallet's RF and syncing back to it | live contracts |
| Network | none: the simulated build makes **no** external request (Friend art answered from the SDK's recorded frames) | RPC, wallet SDK |

## How the founders' SDK v0.2.1 plugs in

The seam is `WalletProvider`. SDK v0.2.1 can replace `PrivyProvider` entirely: implement the interface in `packages/wallet/src/<name>.ts` (login/logout, address, sign, send, `onChange`, and an `identityClient()` — or its own public client — for `ConnectedGameHost`), add a `WalletChoice` in `config.ts`, and keep the contract suite green (`packages/wallet/test/contract.test.ts` runs every provider through the same assertions with its SDK mocked). If v0.2.1 ships its own host component that manages the wallet, `apps/mobile/web/src/game-screen.tsx` is the one file that mounts the game.

## PWA / offline

- `dist-test-app/` uses only relative URLs, so it can be hosted under any path (e.g. a GitHub Pages project site); the tests serve it under `/penalty-kings-app/`.
- `sw.js` precaches every file (cache `pk-test-<version>-<content hash>`), serves cache-first, and waits for the page: a new version shows **"New version — tap to reload"**.
- A sandboxed (opaque-origin) frame is not routed through a service worker, so the game child ships as one self-contained `game/frame.html` (scripts, styles, fonts inline; CSP allows the scripts by SHA-256 hash only) that the shell fetches through the service worker and hands to the SDK as a `blob:` URL. The sandbox is unchanged (`allow-scripts`).
- Manifest (standalone, landscape, theme `#0b0d1a`), icons, apple-touch-icon and iOS launch images generated from the game's own pixel art (`scripts/gen-test-app-art.mjs`), safe-area insets, no rubber-band scrolling, `noindex`, audio unlock on the first tap (the game unlocks its own audio in-frame as before), the game's rotate overlay unchanged, state in `localStorage` with an in-memory fallback.
- The version (`apps/mobile/web/package.json` + build number + short sha) is in **Settings**.
