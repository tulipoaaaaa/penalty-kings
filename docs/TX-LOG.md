# Mainnet transaction log

Every mainnet transaction from the Penalty Kings burner wallet. Each one is first rehearsed on
an anvil fork of Robinhood mainnet with the same script and arguments. The entry is written
**before** sending (purpose, target, function, arguments, value, gas estimate), then completed
with the hash, receipt status and a Blockscout link.

Status: **1 burner transaction on record**, sent manually by the owner from their own wallet app
(not through the rehearsal pipeline). It is verified on-chain below. Pipeline rows are appended by
`scripts/onchain/lib.mjs`. The burner's incoming funding transfers are deliberately not listed here:
they identify the sending wallets.

| Time (UTC) | Purpose | To | Function / args | Value | Gas est. | Fork rehearsal | Tx hash | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-09-27 (block 73,713,157) | Hardwire the burner's Friend (Phase 2) — **sent by the owner manually** | ActivationManager `0xD4A35e11318E3679168d409184B788bcF9F283Ac` | `hardwire(2)` | 0 | n/a (gas used 351,044) | not rehearsed (owner-sent) | [`0xd6a6a8b9…c78d0`](https://robinhoodchain.blockscout.com/tx/0xd6a6a8b911e7a7eba8b5e5771a4ad17ed3fe3af785a1b7e16e0640e86acc78d0) | **success** (status 1). Verified by the agent via RPC: Friend **#336583** hardwired at **Gen 2**, owner = burner; 10,000 RF paid (5,000 burned); token-bound account created |
