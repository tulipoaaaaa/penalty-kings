/**
 * The full game, hosted by the SDK's own ConnectedGameHost (the documented integration for apps that already
 * manage the wallet): the same sandboxed child as play:dev, the same fresh ownership gate (answered by the
 * provider's identity client), the SDK's in-frame confirmations and its simulated preview economy.
 * The preview ledger starts at the test wallet's RF and reports its balance back after every purchase.
 */
import { useEffect, useMemo, useState } from "react";
import { ConnectedGameHost } from "@rarefriends/friendsdk/runtime";
import { parseChanceGame } from "@rarefriends/friendsdk/game";
import "@rarefriends/friendsdk/frame.css";
import "@rarefriends/friendsdk/runtime.css";
import "../../../../games/penalty-kings/host.css";
import gameJson from "../../../../games/penalty-kings/game.json" with { type: "json" };
import { ROBINHOOD_CHAIN, type AnyProvider, type FriendRef } from "./wallet.ts";

type Ledger = { read(): Promise<{ rfBalance: bigint }> };
type TestGlobals = { __pkTestRfBalance?: bigint; __pkTestOnLedger?: (ledger: Ledger) => void };
const definition = parseChanceGame(gameJson);

export function GameScreen({ provider, friend, startRf }: { provider: AnyProvider; friend: FriendRef; startRf: bigint }) {
  const address = provider.getAddress()!;
  const client = useMemo(() => provider.identityClient(), [provider, address]);
  // Must be set before ConnectedGameHost renders: the (build-patched) SDK host reads it when it creates the ledger.
  const [ledgerHolder] = useState(() => {
    const holder: { ledger: Ledger | null } = { ledger: null };
    const globals = globalThis as TestGlobals;
    globals.__pkTestRfBalance = startRf;
    globals.__pkTestOnLedger = ledger => { holder.ledger = ledger; };
    return holder;
  });
  useEffect(() => {
    let alive = true;
    const id = window.setInterval(() => {
      const ledger = ledgerHolder.ledger;
      if (!ledger) return;
      void ledger.read().then(snapshot => { if (alive) provider.economy.setBalance(address, snapshot.rfBalance); }).catch(() => undefined);
    }, 800);
    return () => { alive = false; window.clearInterval(id); };
  }, [ledgerHolder, provider, address]);
  // The child document (one self-contained file, see scripts/build-test-app.mjs) comes through the service worker,
  // so it also loads offline; the sandboxed frame gets it as a blob: URL.
  const [frame, setFrame] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let url: string | null = null, alive = true;
    fetch("./game/frame.html").then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); })
      .then(html => { url = URL.createObjectURL(new Blob([html], { type: "text/html" })); if (alive) setFrame({ url, error: null }); })
      .catch(error => { if (alive) setFrame({ url: null, error: error instanceof Error ? error.message : String(error) }); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [attempt]);
  const selectedFriend = useMemo(() => ({ id: BigInt(friend.id), label: `Friend #${friend.id}`, kind: "owned" as const }), [friend.id]);
  if (!frame.url) return <div className="pkt-frame" data-testid="game-host"><div className="pkt-panel" role={frame.error ? "alert" : "status"} style={{ margin: "24px auto" }}>
    <p>{frame.error ? `The game could not load (${frame.error}).` : "Loading the game…"}</p>
    {frame.error && <button className="pkt-btn pkt-primary" onClick={() => setAttempt(value => value + 1)}>Retry</button>}
  </div></div>;
  return <div className="pkt-frame" data-testid="game-host">
    <ConnectedGameHost definition={definition} frameUrl={frame.url} selectedFriend={selectedFriend} account={address}
      chainId={ROBINHOOD_CHAIN.id} publicClient={client as never} revision={0} />
  </div>;
}
