/**
 * Penalty Kings Clubhouse — the trusted LIVE page for actions the FriendSDK game sandbox cannot
 * perform (its CSP allows only the Robinhood RPC and it has no signer):
 *   • Skill Cup: on-chain entry (SkillCup.enter) + 5 kicks judged by the replay referee
 *   • Kit shop: KitShop.buy burns $GBOOT for cosmetics recorded per Friend
 *   • Wildcards: an extra Golden Boot Cup draw with Dice randomness
 * Wallet connection, owned-Friend discovery and the fresh hardwired check are the SDK's own
 * (`wallet`, `owned`, `identity` modules). Every transaction needs an explicit confirmation here
 * AND in the wallet, and is only reported after a successful receipt.
 */
import { StrictMode, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createRoot } from "react-dom/client";
import { createWalletClient, custom, defineChain, formatUnits, parseAbi, parseEventLogs, type Address, type Hash, type TransactionReceipt } from "viem";
import { createFriendWalletSession, createFriendPublicClient } from "@rarefriends/friendsdk/wallet";
import { readOwnedFriends, type OwnedFriend } from "@rarefriends/friendsdk/owned";
import { readGenerationEligibility } from "@rarefriends/friendsdk/identity";
import { createFriendReader, spriteFrame, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { keeperById, shotTarget, clamp, type ShotResult } from "@penalty-kings/engine";
import { COSMETICS } from "../games/penalty-kings/economy.js";
import { renderScene, ballFlightScreen, keeperPose, toScreen, SPOT, W, H, type SceneState } from "../games/penalty-kings/scene.js";
import "./style.css";

declare const __PK_LIVE__: { gboot?: Address; kitShop?: Address; skillCup?: Address; wildcards?: Address; refereeUrl?: string; explorer: string; rpcUrl?: string };
const LIVE = __PK_LIVE__;
const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } } });
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"]);
const KITSHOP = parseAbi(["function buy(uint256 friendId, uint256 itemId)", "function unlocked(uint256 friendId, uint256 itemId) view returns (bool)", "function price(uint256 itemId) view returns (uint256)"]);
const SKILLCUP = parseAbi(["function enter(uint256 friendId) returns (uint256)", "function week() view returns (uint256)", "event Entered(uint256 indexed entryId, uint256 indexed friendId, address indexed player, uint256 week)"]);
const WILDCARDS = parseAbi(["function draw(uint256 friendId) payable returns (uint256)", "function drawOf(uint256) view returns (uint256 friendId, uint8 points, bool fulfilled)", "function entropy() view returns (address)", "function provider() view returns (address)", "event WildcardRequested(uint256 indexed drawId, uint256 indexed friendId, uint64 sequenceNumber)"]);
const ENTROPY = parseAbi(["function getFeeV2(address provider, uint32 gasLimit) view returns (uint128)"]);
const FRIEND_WALLET = parseAbi(["function execute(address to, uint256 value, bytes data, uint8 operation) payable returns (bytes result)"]);
const MAX_DICE_FEE = 25_000_000_000_000n; // 0.000025 ETH, the FriendSDK cap
const ENTRY = 100n * 10n ** 18n;
const fmt = (value: bigint) => Number(formatUnits(value, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });

type Confirm = { title: string; lines: string[]; resolve: (ok: boolean) => void };

function App() {
  const session = useMemo(() => createFriendWalletSession(), []);
  const client = useMemo(() => createFriendPublicClient(LIVE.rpcUrl ? { rpcUrl: LIVE.rpcUrl } : undefined), []);
  const [wallet, setWallet] = useState(session.getSnapshot());
  const [friends, setFriends] = useState<readonly OwnedFriend[] | null>(null);
  const [friend, setFriend] = useState<OwnedFriend | null>(null);
  const [eligible, setEligible] = useState<"checking" | "yes" | "no" | null>(null);
  const [error, setError] = useState(""), [status, setStatus] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [balances, setBalances] = useState<{ owner: bigint; friend: bigint } | null>(null);
  const [tab, setTab] = useState<"skill" | "shop" | "wild">("skill");
  const [refresh, setRefresh] = useState(0);
  const account = wallet.account, ready = wallet.status === "connected" && wallet.chainId === 4663 && account;

  useEffect(() => session.subscribe(() => setWallet(session.getSnapshot())), [session]);
  useEffect(() => {
    setFriends(null); setFriend(null); setEligible(null); setBalances(null);
    if (!ready) return;
    const abort = new AbortController();
    readOwnedFriends(client, account!, { signal: abort.signal }).then(result => { if (!abort.signal.aborted) setFriends(result.friends); })
      .catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Friend discovery failed."); });
    return () => abort.abort();
  }, [ready, account, wallet.revision, client]);
  useEffect(() => {
    if (!friend || !account) return;
    let live = true; setEligible("checking");
    readGenerationEligibility(client as never, friend.id, account).then(result => { if (live) setEligible(result.eligible ? "yes" : "no"); })
      .catch(() => { if (live) setEligible("no"); });
    return () => { live = false; };
  }, [friend, account, wallet.revision, client]);
  useEffect(() => {
    if (eligible !== "yes" || !friend || !account || !LIVE.gboot) return;
    let live = true;
    Promise.all([account, friend.walletAddress].map(address => client.readContract({ address: LIVE.gboot!, abi: ERC20, functionName: "balanceOf", args: [address] })))
      .then(([owner, friendBalance]) => { if (live) setBalances({ owner, friend: friendBalance }); }).catch(() => undefined);
    return () => { live = false; };
  }, [eligible, friend, account, refresh, client]);

  const ask = (title: string, lines: string[]) => new Promise<boolean>(resolve => setConfirm({ title, lines, resolve }));
  /** Send one transaction after explicit confirmation; report only after a successful receipt. */
  async function send(label: string, lines: string[], request: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[]; value?: bigint }) {
    if (!(await ask(label, lines))) throw new Error("Cancelled.");
    const revision = session.getSnapshot().revision;
    const provider = session.getProvider();
    if (!provider || !account) throw new Error("Wallet disconnected.");
    const signer = createWalletClient({ account, chain, transport: custom(provider) });
    setStatus(`${label}: confirm in your wallet…`);
    const hash = await signer.writeContract(request as never) as Hash;
    setStatus(`${label}: waiting for confirmation…`);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (session.getSnapshot().revision !== revision) throw new Error("Wallet changed during the transaction; refresh before continuing.");
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${LIVE.explorer}/tx/${hash}`);
    setStatus(`${label} confirmed.`); setRefresh(value => value + 1);
    return receipt;
  }
  async function approveIfNeeded(spender: Address, amount: bigint) {
    const allowance = await client.readContract({ address: LIVE.gboot!, abi: ERC20, functionName: "allowance", args: [account!, spender] });
    if (allowance < amount) await send("Approve $GBOOT", [`Allow exactly ${fmt(amount)} $GBOOT to be spent by ${spender}.`], { address: LIVE.gboot!, abi: ERC20, functionName: "approve", args: [spender, amount] });
  }
  const guard = async (work: () => Promise<void>) => { setError(""); try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus(""); } };

  const deployed = Boolean(LIVE.gboot && LIVE.kitShop && LIVE.skillCup && LIVE.wildcards);
  return <main className="club">
    <header><h1>Penalty Kings · Clubhouse</h1><span className="live-tag">LIVE — real $GBOOT and ETH</span></header>
    <p className="lede">Real on-chain actions for your hardwired Rare Friend: Skill Cup entries, kit unlocks and Cup wildcards. Every action asks for confirmation here and in your wallet.</p>
    {!deployed && <p className="warn">The live contracts are not deployed yet. See the project's docs/DEPLOYMENT.md.</p>}

    <section className="card">
      <h2>1 · Wallet</h2>
      {wallet.status === "unavailable" ? <p>No browser wallet found. Enable your wallet extension or open this page in your wallet's browser.</p>
        : !account ? <button onClick={() => void session.connect()}>Connect wallet</button>
        : wallet.chainId !== 4663 ? <button onClick={() => void session.switchNetwork()}>Switch to Robinhood</button>
        : <p>Connected: <code>{account}</code> <button className="link" onClick={() => session.disconnect()}>Disconnect</button></p>}
      {wallet.error && <p role="alert">{wallet.error}</p>}
    </section>

    {ready && <section className="card">
      <h2>2 · Your Friend</h2>
      {!friends ? <p role="status">Finding your Friends on Robinhood…</p>
        : friends.length === 0 ? <p>No hardwired Friends in this wallet. Hardwiring makes a Friend permanent (rarefriends.com).</p>
        : <div className="friends">{friends.map(item => <button key={item.id.toString()} aria-pressed={friend?.id === item.id} onClick={() => setFriend(item)}>
          Friend #{item.id.toString()} · Gen {item.generation}</button>)}</div>}
      {eligible === "checking" && <p role="status">Checking ownership and hardwired eligibility…</p>}
      {eligible === "no" && <p role="alert">This wallet must own the selected hardwired Friend (generation 1 or higher).</p>}
      {eligible === "yes" && balances && <p>$GBOOT in your wallet: <b>{fmt(balances.owner)}</b> · in Friend #{friend!.id.toString()}'s wallet: <b>{fmt(balances.friend)}</b>
        {balances.friend > 0n && <button className="small" onClick={() => void guard(async () => {
          await send("Move $GBOOT to your wallet", [`Your Friend's wallet ${friend!.walletAddress} transfers ${fmt(balances.friend)} $GBOOT to ${account}.`, "Ball drops are paid to the Friend's wallet; entries are paid from yours."],
            { address: friend!.walletAddress, abi: FRIEND_WALLET, functionName: "execute", args: [LIVE.gboot!, 0n, encodeTransfer(account!, balances.friend), 0] });
        })}>Move to my wallet</button>}</p>}
    </section>}

    {ready && eligible === "yes" && friend && deployed && <>
      <nav className="tabs">
        <button aria-pressed={tab === "skill"} onClick={() => setTab("skill")}>Skill Cup</button>
        <button aria-pressed={tab === "shop"} onClick={() => setTab("shop")}>Kit shop</button>
        <button aria-pressed={tab === "wild"} onClick={() => setTab("wild")}>Wildcards</button>
      </nav>
      {tab === "skill" && <SkillCupPanel friend={friend} client={client} send={send} approve={approveIfNeeded} guard={guard} />}
      {tab === "shop" && <ShopPanel friend={friend} client={client} send={send} approve={approveIfNeeded} guard={guard} refresh={refresh} />}
      {tab === "wild" && <WildcardPanel friend={friend} client={client} send={send} approve={approveIfNeeded} guard={guard} />}
    </>}

    {(status || error) && <p className={error ? "error" : "status"} role={error ? "alert" : "status"}>{error || status}</p>}
    {confirm && <div className="scrim"><div className="dialog" role="dialog" aria-label={confirm.title}>
      <h3>{confirm.title}</h3>{confirm.lines.map(line => <p key={line}>{line}</p>)}
      <p className="small-print">This is a real Robinhood mainnet transaction and costs ETH gas.</p>
      <div className="row"><button onClick={() => { confirm.resolve(false); setConfirm(null); }}>Cancel</button>
        <button className="primary" autoFocus onClick={() => { confirm.resolve(true); setConfirm(null); }}>Confirm</button></div>
    </div></div>}
  </main>;
}

function encodeTransfer(to: Address, amount: bigint) {
  // transfer(address,uint256)
  return `0xa9059cbb${to.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}` as `0x${string}`;
}

type PanelProps = {
  friend: OwnedFriend; client: ReturnType<typeof createFriendPublicClient>;
  send: (label: string, lines: string[], request: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[]; value?: bigint }) => Promise<TransactionReceipt>;
  approve: (spender: Address, amount: bigint) => Promise<void>;
  guard: (work: () => Promise<void>) => Promise<void>;
};

function ShopPanel({ friend, client, send, approve, guard, refresh }: PanelProps & { refresh: number }) {
  const [unlocked, setUnlocked] = useState<boolean[] | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(COSMETICS.map((_, index) => client.readContract({ address: LIVE.kitShop!, abi: KITSHOP, functionName: "unlocked", args: [friend.id, BigInt(index)] })))
      .then(values => { if (live) setUnlocked(values); }).catch(() => undefined);
    return () => { live = false; };
  }, [friend, refresh, client]);
  return <section className="card">
    <h2>Kit shop</h2>
    <p>$GBOOT is <b>burned</b> for each unlock. Unlocks are recorded on-chain for Friend #{friend.id.toString()} and appear in the live game.</p>
    <div className="items">{COSMETICS.map((item, index) => <div className="item" key={item.id}>
      {item.color && <i className="swatch" style={{ background: item.color }} />}<span>{item.name}</span>
      {unlocked?.[index] ? <em>unlocked</em> : <button disabled={!unlocked} onClick={() => void guard(async () => {
        const price = BigInt(item.price) * 10n ** 18n;
        if (price > 0n) await approve(LIVE.kitShop!, price);
        await send(`Unlock ${item.name}`, [`Burn ${item.price} $GBOOT to unlock ${item.name} for Friend #${friend.id}.`], { address: LIVE.kitShop!, abi: KITSHOP, functionName: "buy", args: [friend.id, BigInt(index)] });
      })}>{item.price ? `${item.price} $GBOOT` : "Free"}</button>}
    </div>)}</div>
  </section>;
}

function WildcardPanel({ friend, client, send, approve, guard }: PanelProps) {
  const [draw, setDraw] = useState<{ id: bigint; points: number | null } | null>(null);
  useEffect(() => {
    if (!draw || draw.points !== null) return;
    const timer = setInterval(() => {
      void client.readContract({ address: LIVE.wildcards!, abi: WILDCARDS, functionName: "drawOf", args: [draw.id] }).then(([, points, fulfilled]) => {
        if (fulfilled) setDraw({ id: draw.id, points });
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [draw, client]);
  return <section className="card">
    <h2>Wildcards: an extra Golden Boot Cup draw</h2>
    <p>100 $GBOOT (50% burned, 50% to the Cup pot) + the Dice randomness fee (≤ 0.000025 ETH). Odds: Gold 2.5% (1 race point), Golden Boot 1% (2 points), otherwise no points. Points count toward this week's Cup race.</p>
    <button className="primary" onClick={() => void guard(async () => {
      const [entropy, provider] = await Promise.all([client.readContract({ address: LIVE.wildcards!, abi: WILDCARDS, functionName: "entropy" }), client.readContract({ address: LIVE.wildcards!, abi: WILDCARDS, functionName: "provider" })]);
      const fee = await client.readContract({ address: entropy, abi: ENTROPY, functionName: "getFeeV2", args: [provider, 200_000] });
      if (fee > MAX_DICE_FEE) throw new Error("Dice fee is above the 0.000025 ETH cap; try later.");
      await approve(LIVE.wildcards!, ENTRY);
      const receipt = await send("Draw a wildcard", [`Pay 100 $GBOOT and ${formatUnits(fee, 18)} ETH (Dice fee) for one draw for Friend #${friend.id}.`], { address: LIVE.wildcards!, abi: WILDCARDS, functionName: "draw", args: [friend.id], value: fee });
      const [requested] = parseEventLogs({ abi: WILDCARDS, eventName: "WildcardRequested", logs: receipt.logs.filter(log => log.address.toLowerCase() === LIVE.wildcards!.toLowerCase()) });
      if (!requested) throw new Error("Draw receipt has no WildcardRequested event.");
      setDraw({ id: requested.args.drawId, points: null });
    })}>Draw a wildcard</button>
    {draw && <p role="status">{draw.points === null ? `Draw #${draw.id}: waiting for Dice randomness…` : draw.points === 2 ? "Golden Boot! +2 race points" : draw.points === 1 ? "Gold! +1 race point" : "No points this time."}</p>}
  </section>;
}

type Kick = { result: ShotResult; points: number; dive: { x: number; y: number } };

function SkillCupPanel({ friend, client, send, approve, guard }: PanelProps) {
  const [entry, setEntry] = useState<number | null>(null);
  const [kicks, setKicks] = useState<Kick[]>([]);
  const [score, setScore] = useState(0), [signed, setSigned] = useState<string | null>(null);
  const [board, setBoard] = useState<{ entryId: number; friendId: string; score: number }[]>([]);
  const [week, setWeek] = useState<{ week: number; secretHash: string } | null>(null);
  const referee = LIVE.refereeUrl;
  useEffect(() => {
    if (!referee) return;
    void fetch(`${referee}/week`).then(r => r.json()).then(setWeek).catch(() => undefined);
    void fetch(`${referee}/leaderboard`).then(r => r.json()).then(setBoard).catch(() => undefined);
  }, [referee, signed]);
  if (!referee) return <section className="card"><h2>Skill Cup</h2><p className="warn">The replay referee is not deployed yet, so entries are closed. Nothing is charged.</p></section>;
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${referee}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Referee error.");
    return data;
  };
  return <section className="card">
    <h2>Skill Cup: 5 kicks vs Ghost</h2>
    <p>Entry 100 $GBOOT (50% burned, 50% to the pot), paid on-chain. The referee replays every kick: your inputs are committed before the keeper's dive is derived from this week's secret{week ? <> (hash <code>{week.secretHash.slice(0, 18)}…</code>, revealed after week {week.week})</> : null}. Best score wins; ties go to the earlier entry. One entry per Friend per hour, 20 per week.</p>
    {entry === null ? <button className="primary" onClick={() => void guard(async () => {
      await approve(LIVE.skillCup!, ENTRY);
      const receipt = await send("Enter the Skill Cup", [`Pay 100 $GBOOT (50 burned, 50 to the pot) for one shootout with Friend #${friend.id}.`], { address: LIVE.skillCup!, abi: SKILLCUP, functionName: "enter", args: [friend.id] });
      const registered = await post("/entry", { txHash: receipt.transactionHash });
      setEntry(registered.entryId); setKicks([]); setScore(0); setSigned(null);
    })}>Enter · 100 $GBOOT</button>
      : <SkillPitch friendId={friend.id} kicks={kicks} disabled={kicks.length >= 5} onShoot={async input => {
        const response = await post("/kick", { entryId: entry, kickIndex: kicks.length, input });
        setKicks(list => [...list, { result: response.result, points: response.points, dive: response.dive }]);
        setScore(response.score);
        if (response.signed) setSigned(response.signed.signature);
        return response as Kick;
      }} />}
    {entry !== null && <p>Entry #{entry} · kicks {kicks.map(kick => kick.result === "goal" ? "●" : "○").join(" ")} · score <b>{score}</b>{signed && <> · signed by the referee <code>{signed.slice(0, 16)}…</code> <button className="link" onClick={() => setEntry(null)}>New entry</button></>}</p>}
    <h3>This week</h3>
    <ol className="board">{board.slice(0, 10).map(row => <li key={row.entryId}>Friend #{row.friendId} · entry #{row.entryId} · <b>{row.score}</b></li>)}</ol>
  </section>;
}

/** Canvas pitch for Skill Cup kicks: same renderer and input mapping as the game; results come from the referee. */
function SkillPitch({ friendId, kicks, disabled, onShoot }: { friendId: bigint; kicks: Kick[]; disabled: boolean; onShoot: (input: { aimX: number; loft: number; power: number; curl: number; releaseMs: number }) => Promise<Kick> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sprites = useRef<GenerationSprites | null>(null);
  const shot = useRef<{ target: { x: number; y: number; time: number }; curl: number; kick: Kick | null; start: number } | null>(null);
  const aim = useRef({ aimX: 0.5, power: 0, curl: 0, start: performance.now() });
  const drag = useRef<{ x: number; y: number }[] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { createFriendReader().read(friendId).then(value => { sprites.current = value; }).catch(() => undefined); }, [friendId]);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    let frame = 0;
    const state: SceneState = { time: 0, keeper: "ghost", keeperPose: { x: 0, y: 0.2, rotate: 0, lift: 0 }, ball: { x: SPOT.x, y: SPOT.y, r: 4.5, color: "#fff", accent: "#6a7a90", visible: true, spin: 0 }, trail: [], friend: { rows: null, x: 232, y: 262, scale: 3, halo: "#fff", boots: "#111" }, netColor: "#e8e8e8", ripple: null, shake: 0, roar: 0, reticle: null, flash: null };
    const draw = (now: number) => {
      state.time = now / 1000;
      state.friend = { ...state.friend, rows: sprites.current ? spriteFrame(sprites.current, "up", false, 0, "right").frame.rows : null };
      const current = shot.current, ghost = keeperById("ghost");
      if (current?.kick) {
        const duration = current.target.time * 1.6, p = clamp((now - current.start) / 1000 / duration, 0, 1);
        const position = ballFlightScreen(current.target, current.curl, p);
        state.ball = { ...state.ball, ...position, visible: true };
        state.keeperPose = keeperPose({ ...current.kick.dive, reaction: ghost.reaction, diveTime: ghost.diveTime, reach: ghost.reach }, p * current.target.time, state.time);
        const end = toScreen(current.target.x, current.target.y);
        state.ripple = p >= 1 && current.kick.result === "goal" ? { x: end.x, y: end.y, t: (now - current.start) / 1000 - duration } : null;
        state.reticle = null;
      } else {
        state.ball = { ...state.ball, x: SPOT.x, y: SPOT.y, r: 4.5 };
        state.keeperPose = keeperPose(null, 0, state.time);
        const target = shotTarget({ aimX: aim.current.aimX, loft: 0, power: drag.current ? aim.current.power : 0.78, curl: aim.current.curl });
        state.reticle = disabled ? null : { x: target.x - aim.current.curl * 0.3, y: target.y, power: aim.current.power, curl: aim.current.curl, aimX: aim.current.aimX, active: Boolean(drag.current) };
      }
      renderScene(context, state);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [disabled]);
  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * W, y: ((event.clientY - rect.top) / rect.height) * H };
  };
  const update = (points: { x: number; y: number }[]) => {
    const start = points[0], end = points[points.length - 1], dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
    aim.current.power = clamp(length / 140, 0, 1);
    aim.current.aimX = clamp(dx / Math.max(12, -dy) / 0.96, -1.4, 1.4);
    let deviation = 0;
    if (length > 8) for (const p of points) { const cross = ((p.x - start.x) * dy - (p.y - start.y) * dx) / length; if (Math.abs(cross) > Math.abs(deviation)) deviation = cross; }
    aim.current.curl = clamp((-deviation / Math.max(40, length)) * 4, -1, 1);
    return length;
  };
  return <div className="pitch">
    <canvas ref={canvas} width={W} height={H} aria-label="Skill Cup pitch: drag up from the ball to shoot"
      onPointerDown={event => { if (disabled || busy) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = [point(event)]; aim.current.start = performance.now(); shot.current = null; }}
      onPointerMove={event => { if (drag.current) { drag.current.push(point(event)); update(drag.current); } }}
      onPointerUp={event => {
        const points = drag.current; drag.current = null;
        if (!points || disabled || busy) return;
        points.push(point(event));
        if (update(points) < 14 || points[points.length - 1].y >= points[0].y) return;
        const input = { aimX: aim.current.aimX, loft: 0, power: aim.current.power, curl: aim.current.curl, releaseMs: Math.round(performance.now() - aim.current.start) };
        setBusy(true); setError("");
        onShoot(input).then(kick => { shot.current = { target: shotTarget(input), curl: input.curl, kick, start: performance.now() }; })
          .catch(cause => setError(cause instanceof Error ? cause.message : "Kick failed."))
          .finally(() => setBusy(false));
      }} />
    <p className="small-print">{busy ? "Referee is resolving your kick…" : error || (disabled ? "Shootout complete." : `Kick ${kicks.length + 1} of 5: drag up from the ball.`)}</p>
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
