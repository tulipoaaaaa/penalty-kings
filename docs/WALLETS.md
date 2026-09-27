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
