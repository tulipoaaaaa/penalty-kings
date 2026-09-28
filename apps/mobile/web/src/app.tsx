/**
 * Penalty Kings (Test) — simulated onboarding → the full game. Every screen shows "TEST BUILD · SIMULATED".
 * Welcome → email/Google → (6-digit code) → Creating your wallet… → address → Get RF (simulated payment sheet)
 * → Get a Friend (loan / already own) → Hardwire (simulated tx) → the game. Plus logout, re-login, reset,
 * every error state with Retry, Settings (version) and a hidden dev menu (5 taps on the version).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { snapshotPrice, rfPriceText, priceAgeLabel } from "../../../../games/penalty-kings/game/price.ts";
import { CONFIG } from "./config.ts";
import { FriendArt } from "./friend-art.tsx";
import { GameScreen } from "./game-screen.tsx";
import { registerServiceWorker } from "./pwa.ts";
import {
  ERROR_COPY, FIXTURE_FRIEND_ID, WalletError, createProvider, formatRf, readOverride, resolveWalletChoice, shortAddress, writeOverride,
  type AnyProvider, type FailureKind, type FriendRef, type LoginMethod, type SimEconomy, type TxResult, type WalletChoice,
} from "./wallet.ts";

type Step = "welcome" | "email" | "code" | "creating" | "address" | "rf" | "friend" | "hardwire" | "game";
const FLOW: Step[] = ["welcome", "address", "rf", "friend", "hardwire", "game"];
const AMOUNTS = [5, 20, 50] as const;
export const BADGE = "TEST BUILD · SIMULATED";

const PAYMENT_HANDLER: Record<AnyProvider["kind"], string> = {
  "dev-simulated": "the payment provider (Privy or the founders' wallet SDK)",
  privy: "Privy",
  injected: "your wallet",
};

function errorText(error: unknown) {
  if (error instanceof WalletError) return error.message.includes("[SIMULATED]") ? `${ERROR_COPY[error.code]} (simulated failure)` : error.message || ERROR_COPY[error.code];
  return error instanceof Error ? error.message : String(error);
}

export function Badge() { return <div className="pkt-badge" data-testid="test-badge" role="note">{BADGE}</div>; }

function ErrorBox({ error, onRetry, onBack }: { error: unknown; onRetry?: () => void; onBack?: () => void }) {
  const code = error instanceof WalletError ? error.code : "error";
  return <div className="pkt-error" role="alert" data-testid="error-box" data-code={code}>
    <p>{errorText(error)}</p>
    <div className="pkt-row">
      {onRetry && <button className="pkt-btn pkt-primary" data-testid="retry" onClick={onRetry}>Retry</button>}
      {onBack && <button className="pkt-btn" data-testid="back" onClick={onBack}>Back</button>}
    </div>
  </div>;
}

function Steps({ step }: { step: Step }) {
  const at = Math.max(0, FLOW.indexOf(step === "email" || step === "code" || step === "creating" ? "welcome" : step));
  return <div className="pkt-steps" aria-hidden="true">{FLOW.slice(0, -1).map((name, index) => <i key={name} data-on={index <= at} />)}</div>;
}

function Screen({ step, children, testid, footer }: { step: Step; children: ReactNode; testid: string; footer?: ReactNode }) {
  return <main className="pkt-screen" data-testid={testid}><section className="pkt-panel"><Steps step={step} />{children}{footer}</section></main>;
}

/** 5 taps within 2.5 s on the version opens the dev menu (test builds only). */
function VersionTap({ onUnlock }: { onUnlock: () => void }) {
  const taps = useRef<number[]>([]);
  return <button className="pkt-version" data-testid="app-version" aria-label={`Version ${CONFIG.version}`} onClick={() => {
    const now = Date.now();
    taps.current = [...taps.current.filter(t => now - t < 2500), now];
    if (taps.current.length >= 5) { taps.current = []; onUnlock(); }
  }}>v{CONFIG.version}</button>;
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const area = document.createElement("textarea"); area.value = text; document.body.appendChild(area); area.select();
      const ok = document.execCommand("copy"); area.remove(); return ok;
    } catch { return false; }
  }
}

/** The neutral simulated payment sheet (our own pixel panel; no platform or provider look-alike). */
function PaymentSheet({ usd, rf, handler, onPay, onClose }: { usd: number; rf: bigint; handler: string; onPay: () => Promise<void>; onClose: () => void }) {
  const [state, setState] = useState<{ busy: boolean; error: unknown }>({ busy: false, error: null });
  const pay = async () => {
    setState({ busy: true, error: null });
    try { await onPay(); } catch (error) { setState({ busy: false, error }); }
  };
  return <div className="pkt-sheet-back" role="dialog" aria-modal="true" aria-labelledby="pkt-sheet-title">
    <div className="pkt-sheet" data-testid="pay-sheet">
      <Badge />
      <h2 id="pkt-sheet-title">Simulated payment (test)</h2>
      <p className="pkt-muted" data-testid="pay-handler">In the real app, {handler} will handle this step.</p>
      <div className="pkt-kv"><dt>Item</dt><dd>{formatRf(rf)} RF (test RF)</dd><dt>Charged</dt><dd>nothing: no card, no account, no money moves</dd></div>
      <div className="pkt-total"><span>Total</span><span>${usd}.00 <span className="pkt-tag">SIMULATED</span></span></div>
      {state.error ? <ErrorBox error={state.error} onRetry={pay} onBack={onClose} /> : null}
      {state.busy ? <><div className="pkt-spinner" /><p className="pkt-muted" role="status">Processing (simulated)…</p></> : !state.error && <div className="pkt-row">
        <button className="pkt-btn" data-testid="pay-cancel" onClick={onClose}>Cancel</button>
        <button className="pkt-btn pkt-primary" data-testid="pay-confirm" onClick={pay}>Pay ${usd} (simulated)</button>
      </div>}
    </div>
  </div>;
}

function DevMenu({ choice, economy, onChoice, onReset, onClose }: { choice: WalletChoice; economy: SimEconomy; onChoice: (c: WalletChoice) => void; onReset: () => void; onClose: () => void }) {
  const [failure, setFailure] = useState(economy.failures.current());
  useEffect(() => economy.failures.subscribe(() => setFailure(economy.failures.current())), [economy]);
  const set = (kind: FailureKind | null, mode: "next" | "always") => economy.failures.set(kind, mode);
  return <div className="pkt-dev" data-testid="dev-menu" role="dialog" aria-label="Developer menu">
    <section className="pkt-panel">
      <h2>Dev menu <span className="pkt-tag">TEST BUILD</span></h2>
      <fieldset><legend>Wallet provider</legend>
        {(["dev", "privy", "injected"] as const).map(value => <label key={value}>
          <input type="radio" name="pkt-provider" data-testid={`dev-provider-${value}`} checked={choice === value} disabled={value === "privy" && !CONFIG.privyAppId}
            onChange={() => onChoice(value)} />
          {value === "dev" ? "DevSimulated (default)" : value === "privy" ? `Privy${CONFIG.privyAppId ? "" : " (no PRIVY_APP_ID in this build)"}` : "Injected browser wallet"}
        </label>)}
      </fieldset>
      <fieldset><legend>Failure injector (next matching step)</legend>
        {([null, "declined", "rejected", "offline", "cancelled"] as const).map(kind => <label key={kind ?? "none"}>
          <input type="radio" name="pkt-failure" data-testid={`dev-failure-${kind ?? "none"}`} checked={(failure?.kind ?? null) === kind} onChange={() => set(kind, failure?.always ? "always" : "next")} />
          {kind ?? "none"}{kind === "declined" ? " (payment)" : kind === "rejected" ? " (signature / tx)" : ""}
        </label>)}
        <label><input type="checkbox" data-testid="dev-failure-always" checked={Boolean(failure?.always)} onChange={event => set(failure?.kind ?? null, event.target.checked ? "always" : "next")} /> keep failing (always)</label>
      </fieldset>
      <button className="pkt-btn" data-testid="dev-reset" onClick={onReset}>Reset test account</button>
      <button className="pkt-btn pkt-primary" data-testid="dev-close" onClick={onClose}>Close</button>
    </section>
  </div>;
}

export function App({ economy }: { economy: SimEconomy }) {
  const [choice, setChoice] = useState<WalletChoice>(() => resolveWalletChoice({ wallet: CONFIG.wallet, privyAppId: CONFIG.privyAppId, testBuild: true }, readOverride(economy.storage)).choice);
  const banner = useMemo(() => resolveWalletChoice({ wallet: CONFIG.wallet, privyAppId: CONFIG.privyAppId, testBuild: true }, readOverride(economy.storage)).banner, [economy, choice]);
  const provider = useMemo(() => createProvider(choice, { economy, privyAppId: CONFIG.privyAppId }), [choice, economy]);
  const [step, setStep] = useState<Step>("welcome");
  const [snapshot, setSnapshot] = useState(() => provider.snapshot());
  const [balance, setBalance] = useState(0n);
  const [friend, setFriend] = useState<FriendRef | null>(null);
  const [error, setError] = useState<{ error: unknown; retry?: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("player@example.test");
  const [code, setCode] = useState("");
  const [sheet, setSheet] = useState<number | null>(null);
  const [bought, setBought] = useState<bigint | null>(null);
  const [tx, setTx] = useState<{ stage: string; progress: number; result?: TxResult } | null>(null);
  const [menu, setMenu] = useState(false);
  const [dev, setDev] = useState(false);
  const [copied, setCopied] = useState(false);
  const [update, setUpdate] = useState<(() => void) | null>(null);
  const codeResolver = useRef<{ resolve: (code: string) => void; reject: (error: unknown) => void } | null>(null);
  const newAccount = useRef(false);
  const price = useMemo(() => snapshotPrice(), []);

  useEffect(() => registerServiceWorker(apply => setUpdate(() => apply)), []);
  const refresh = useCallback(async () => {
    if (!provider.getAddress()) { setBalance(0n); return; }
    try { setBalance((await provider.getBalance()).rf); } catch { /* shown on next step */ }
  }, [provider]);
  useEffect(() => provider.onChange(next => { setSnapshot(next); void refresh(); }), [provider, refresh]);

  const route = useCallback(async () => {
    const friends = await provider.getFriends();
    const ready = friends.find(value => value.hardwired);
    await refresh();
    if (ready) { setFriend(ready); setStep("game"); return; }
    if (newAccount.current) { setStep("address"); return; }
    if (friends[0]) { setFriend(friends[0]); setStep("hardwire"); return; }
    setStep((await provider.getBalance()).rf > 0n ? "friend" : "address");
  }, [provider, refresh]);

  // Session restore (reload, returning user, OAuth return).
  useEffect(() => {
    setSnapshot(provider.snapshot()); setStep("welcome"); setFriend(null); setError(null);
    let alive = true;
    void (async () => {
      try {
        if ("restore" in provider && typeof provider.restore === "function") await provider.restore();
        if (alive && provider.getAddress()) { newAccount.current = false; await route(); }
      } catch (restoreError) { if (alive) setError({ error: restoreError }); }
    })();
    return () => { alive = false; };
  }, [provider, route]);

  /** Runs an action with busy + error (Retry re-runs it). */
  const run = useCallback((action: () => Promise<void>) => {
    const attempt = async () => {
      setError(null); setBusy(true);
      try { await action(); } catch (failure) { setError({ error: failure, retry: () => void attempt() }); } finally { setBusy(false); }
    };
    return attempt();
  }, []);

  const login = (method: LoginMethod) => run(async () => {
    newAccount.current = false;
    let creatingSince = 0;
    await provider.login(method, {
      email,
      getCode: () => new Promise<string>((resolve, reject) => { codeResolver.current = { resolve, reject }; setCode(""); setStep("code"); }),
      onProgress: progress => { if (progress === "creating-wallet") { newAccount.current = true; creatingSince = Date.now(); setStep("creating"); } },
    });
    if (creatingSince) await new Promise(resolve => setTimeout(resolve, Math.max(0, 900 - (Date.now() - creatingSince))));
    await route();
  });
  const cancelCode = () => { codeResolver.current?.reject(new WalletError("cancelled", "Login cancelled.")); codeResolver.current = null; setStep("email"); };

  const buy = async (usd: number) => {
    const { rf } = await provider.buyRF(usd);
    setBought(rf); setSheet(null); await refresh();
  };
  const getFriend = (kind: "loan" | "owned") => run(async () => {
    if (kind === "loan" || provider.kind === "dev-simulated") {
      const value = kind === "loan" ? await provider.loanFriend() : await provider.claimOwnedFriend();
      setFriend(value); setTx(null); setStep("hardwire"); return;
    }
    const owned = (await provider.getFriends()).find(value => value.hardwired && !value.simulated);
    if (!owned) throw new WalletError("unsupported", "No hardwired Friend found in this wallet. Loan one instead (free).");
    setFriend(owned); setStep("game");
  });
  const hardwire = () => run(async () => {
    if (!friend) return;
    setTx({ stage: "signing", progress: 0.05 });
    try {
      const result = await provider.hardwire(friend.id, progress => setTx(current => ({ ...current, ...progress })));
      setTx({ stage: "confirmed", progress: 1, result });
      setFriend({ ...friend, hardwired: true });
    } catch (failure) { setTx(null); throw failure; }
  });
  const logout = () => run(async () => { setMenu(false); await provider.logout(); setFriend(null); setBought(null); setTx(null); setStep("welcome"); });
  const reset = () => run(async () => {
    setMenu(false); setDev(false);
    if (provider.getAddress()) await provider.resetTestAccount();
    else await provider.logout();
    setFriend(null); setBought(null); setTx(null); setStep("welcome");
  });
  const switchProvider = (next: WalletChoice) => {
    writeOverride(economy.storage, next);
    void provider.logout().catch(() => undefined);
    setChoice(resolveWalletChoice({ wallet: CONFIG.wallet, privyAppId: CONFIG.privyAppId, testBuild: true }, next).choice);
  };

  const address = snapshot.address;
  const version = <VersionTap onUnlock={() => setDev(true)} />;
  const errorBox = error && <ErrorBox error={error.error} onRetry={error.retry} onBack={() => setError(null)} />;
  const overlays = <>
    <Badge />
    {banner && <div className="pkt-banner" data-testid="provider-banner" role="status">{banner}</div>}
    {sheet !== null && <PaymentSheet usd={sheet} rf={provider.economy.quote(sheet)} handler={PAYMENT_HANDLER[provider.kind]} onPay={() => buy(sheet)} onClose={() => setSheet(null)} />}
    {dev && <DevMenu choice={choice} economy={economy} onChoice={switchProvider} onReset={() => void reset()} onClose={() => setDev(false)} />}
    {update && <div className="pkt-toast" role="status"><button className="pkt-btn pkt-primary" data-testid="update-toast" onClick={() => update()}>New version — tap to reload</button></div>}
  </>;

  let body: ReactNode;
  if (step === "welcome") body = <Screen step={step} footer={version} testid="screen-welcome">
    <h1>PENALTY KINGS</h1>
    <p>Score penalties with your Friend. This is the <b>test app</b>: wallet, payments and Friends are simulated.</p>
    <div className="pkt-cols">
      <div style={{ display: "grid", gap: 10 }}>
        {provider.kind === "injected"
          ? <button className="pkt-btn pkt-primary" data-testid="login-injected" disabled={busy} onClick={() => void login("injected")}>Connect browser wallet</button>
          : <>
            <button className="pkt-btn pkt-primary" data-testid="login-email" disabled={busy} onClick={() => { setError(null); setStep("email"); }}>Continue with email</button>
            <button className="pkt-btn" data-testid="login-google" disabled={busy} onClick={() => void login("google")}>Continue with Google{provider.kind === "dev-simulated" ? " (simulated)" : ""}</button>
          </>}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <p className="pkt-muted">Wallet: {provider.label}. {provider.kind === "dev-simulated" ? "No real keys, no real money, no real chain." : "Real login; RF, Friend loan and hardwire stay simulated."}</p>
        {errorBox}
      </div>
    </div>
  </Screen>;
  else if (step === "email") body = <Screen step={step} footer={version} testid="screen-email">
    <h2>Continue with email</h2>
    <label className="pkt-muted" htmlFor="pkt-email">Email (test accounts only; nothing is sent in the simulated build)</label>
    <input id="pkt-email" className="pkt-input" data-testid="email-input" type="email" inputMode="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} />
    {errorBox}
    <div className="pkt-row">
      <button className="pkt-btn" onClick={() => { setError(null); setStep("welcome"); }}>Back</button>
      <button className="pkt-btn pkt-primary" data-testid="send-code" disabled={busy} onClick={() => void login("email")}>Send code</button>
    </div>
  </Screen>;
  else if (step === "code") body = <Screen step={step} footer={version} testid="screen-code">
    <h2>Enter your 6-digit code</h2>
    <p className="pkt-muted">{provider.kind === "dev-simulated" ? "Dev mode: any 6-digit code works (no email was sent)." : `We sent a code to ${email}.`}</p>
    <input className="pkt-input pkt-code" data-testid="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
      onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="6-digit code" />
    <div className="pkt-row">
      <button className="pkt-btn" data-testid="code-cancel" onClick={cancelCode}>Cancel</button>
      <button className="pkt-btn pkt-primary" data-testid="verify-code" disabled={code.length !== 6} onClick={() => { codeResolver.current?.resolve(code); codeResolver.current = null; setStep("creating"); }}>Verify</button>
    </div>
  </Screen>;
  else if (step === "creating") body = <Screen step={step} footer={version} testid="screen-creating">
    <h2>Creating your wallet…</h2>
    <div className="pkt-spinner" />
    <p className="pkt-muted" role="status">{provider.kind === "dev-simulated" ? "Simulated: a test address is derived for this account. No keys are created." : "Setting up your embedded wallet."}</p>
    {errorBox}
  </Screen>;
  else if (step === "address") body = <Screen step={step} footer={version} testid="screen-address">
    <h2>Your new wallet</h2>
    <div className="pkt-cols">
      <div style={{ display: "grid", gap: 8 }}>
        <div className="pkt-address" data-testid="wallet-address">{address}</div>
        <button className="pkt-btn" data-testid="copy-address" onClick={() => void copy(address ?? "").then(setCopied)}>{copied ? "Copied!" : "Copy address"}</button>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <p className="pkt-muted">{provider.kind === "dev-simulated" ? <>A <b>simulated</b> Robinhood Chain address for this test account. Nothing can sign for it; don't send anything to it.</> : "Your embedded wallet on Robinhood Chain (4663)."}</p>
        <button className="pkt-btn pkt-primary" data-testid="next-get-rf" onClick={() => setStep("rf")}>Next: Get RF</button>
      </div>
    </div>
  </Screen>;
  else if (step === "rf") body = <Screen step={step} footer={version} testid="screen-rf">
    <h2>Get RF <span className="pkt-tag">SIMULATED</span></h2>
    <p className="pkt-muted" data-testid="price-label">{rfPriceText(price, Date.now())} · price: {priceAgeLabel(price, Date.now())} (not live)</p>
    <div className="pkt-amounts">
      {AMOUNTS.map(usd => <button key={usd} className="pkt-btn pkt-amount" data-testid={`rf-${usd}`} disabled={busy} onClick={() => { setError(null); setSheet(usd); }}>
        ${usd}<small>≈ {formatRf(provider.economy.quote(usd))} RF</small>
      </button>)}
    </div>
    {bought !== null && <p className="pkt-ok" data-testid="rf-added" role="status">+{formatRf(bought)} RF added <span className="pkt-tag">SIMULATED</span> · balance {formatRf(balance)} RF</p>}
    {errorBox}
    <div className="pkt-row">
      <button className="pkt-link" data-testid="skip-rf" onClick={() => setStep("friend")}>{bought === null ? "Skip for now" : ""}</button>
      {bought !== null && <button className="pkt-btn pkt-primary" data-testid="next-friend" onClick={() => setStep(friend?.hardwired ? "game" : "friend")}>{friend?.hardwired ? "Back to the game" : "Next: Get a Friend"}</button>}
    </div>
  </Screen>;
  else if (step === "friend") body = <Screen step={step} footer={version} testid="screen-friend">
    <h2>Get a Friend</h2>
    <div className="pkt-friend"><FriendArt /><div><b>Friend #{FIXTURE_FRIEND_ID}</b><p className="pkt-muted">Test fixture Friend (FriendSDK sample art). You play penalties as your Friend.</p></div></div>
    {errorBox}
    <div className="pkt-row">
      <button className="pkt-btn pkt-primary" data-testid="friend-loan" disabled={busy} onClick={() => void getFriend("loan")}>Loan a Friend (free)</button>
      <button className="pkt-btn" data-testid="friend-owned" disabled={busy} onClick={() => void getFriend("owned")}>I already own one</button>
    </div>
    <p className="pkt-muted">{provider.kind === "dev-simulated" ? "Both options are simulated in this build." : "Loans are simulated; an owned Friend is read from Robinhood Chain (read-only)."}</p>
  </Screen>;
  else if (step === "hardwire") body = <Screen step={step} footer={version} testid="screen-hardwire">
    <h2>Hardwire Friend #{friend?.id}</h2>
    <div className="pkt-friend"><FriendArt /><div><b>{friend?.relation === "loaned" ? "Loaned (free)" : "Yours"}</b><p className="pkt-muted">Hardwiring lets your Friend play. Here it is a <b>simulated</b> transaction: nothing is sent to any chain.</p></div></div>
    {tx && <div data-testid="hardwire-progress" data-stage={tx.stage}>
      <div className="pkt-progress"><i style={{ width: `${Math.round(tx.progress * 100)}%` }} /></div>
      <p className="pkt-muted" role="status">{{ signing: "Signing (simulated)…", sending: "Sending (simulated)…", confirming: "Confirming (simulated)…", confirmed: "Hardwired!" }[tx.stage] ?? tx.stage}</p>
      {tx.result && <p className="pkt-address" data-testid="tx-hash">SIMULATED tx {shortAddress(tx.result.hash)}</p>}
    </div>}
    {errorBox}
    {tx?.result
      ? <button className="pkt-btn pkt-primary" data-testid="enter-game" onClick={() => setStep("game")}>Kick off! ▶</button>
      : <button className="pkt-btn pkt-primary" data-testid="hardwire-start" disabled={busy} onClick={() => void hardwire()}>Hardwire (simulated)</button>}
  </Screen>;
  else body = <div className="pkt-game" data-testid="screen-game">
    <header className="pkt-bar">
      <Badge />
      <span className="pkt-balance" data-testid="balance">Wallet <b>{formatRf(balance)} RF</b></span>
      <button data-testid="menu-open" aria-label="Account and settings" onClick={() => setMenu(true)}>☰</button>
    </header>
    {friend && address && <GameScreen key={`${choice}:${address}:${friend.id}`} provider={provider} friend={friend} startRf={balance} />}
    {menu && <div className="pkt-menu" onClick={event => { if (event.target === event.currentTarget) setMenu(false); }}>
      <section className="pkt-panel" data-testid="menu" role="dialog" aria-label="Account and settings">
        <h2>Account</h2>
        <dl className="pkt-kv">
          <dt>Wallet</dt><dd>{provider.label}</dd>
          <dt>Account</dt><dd>{snapshot.accountHint}</dd>
          <dt>Address</dt><dd data-testid="menu-address">{address}</dd>
          <dt>Balance</dt><dd>{formatRf(balance)} RF <span className="pkt-tag">SIMULATED</span></dd>
          <dt>Friend</dt><dd>#{friend?.id} ({friend?.relation}{friend?.simulated ? ", simulated" : ""})</dd>
        </dl>
        <div className="pkt-row">
          <button className="pkt-btn" data-testid="copy-address-menu" onClick={() => void copy(address ?? "")}>Copy address</button>
          <button className="pkt-btn" data-testid="get-more-rf" onClick={() => { setMenu(false); setBought(null); setStep("rf"); }}>Get RF</button>
        </div>
        <h2>Settings</h2>
        <dl className="pkt-kv" data-testid="settings"><dt>Version</dt><dd data-testid="settings-version">{CONFIG.version}</dd><dt>App</dt><dd>{CONFIG.appName} · {CONFIG.appId}</dd></dl>
        <VersionTap onUnlock={() => { setMenu(false); setDev(true); }} />
        {errorBox}
        <button className="pkt-btn" data-testid="logout" onClick={() => void logout()}>Log out</button>
        <button className="pkt-btn" data-testid="reset-account" onClick={() => { if (confirm("Reset the test account? Its simulated RF and Friends are wiped.")) void reset(); }}>Reset test account</button>
        <button className="pkt-btn pkt-primary" data-testid="menu-close" onClick={() => setMenu(false)}>Back to the game</button>
      </section>
    </div>}
  </div>;

  return <>{body}{overlays}</>;
}
