// DEV ONLY — never shipped. A read-only EIP-1193 wallet for local play in plain Chrome.
// It impersonates the (public) owner address of a hardwired Friend you pick, so the REAL SDK
// runtime runs its REAL ownership gate against Robinhood mainnet. It cannot sign: every signing
// or transaction method is refused. The economy stays the simulated preview.
(() => {
  const RPC = "https://rpc.mainnet.chain.robinhood.com";
  const GENERATIONS = "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D";
  const SAMPLES = ["336583", "7730", "3412", "15008", "78784", "86300"];
  const listeners = new Map();
  let accounts = [];
  const emit = (event, value) => (listeners.get(event) ?? []).forEach(fn => fn(value));
  const call = async (to, data) => {
    const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) });
    return (await response.json()).result;
  };
  async function ownerOf(id) { // ownerOf(uint256) = 0x6352211e
    const result = await call(GENERATIONS, "0x6352211e" + BigInt(id).toString(16).padStart(64, "0"));
    if (!result || result.length < 66) throw new Error("ownerOf failed");
    return "0x" + result.slice(-40);
  }
  window.ethereum = {
    isPenaltyKingsDevWallet: true,
    async request({ method }) {
      if (method === "eth_accounts") return accounts;
      if (method === "eth_requestAccounts") { if (!accounts.length) await choose(SAMPLES[0]); return accounts; }
      if (method === "eth_chainId") return "0x1237";
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      throw Object.assign(new Error(`DEV mock wallet is read-only: ${method} refused`), { code: 4200 });
    },
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
    removeListener(event, fn) { listeners.get(event)?.delete(fn); },
  };
  async function choose(id) {
    status.textContent = `Reading owner of Friend #${id}…`;
    try {
      const owner = await ownerOf(id);
      accounts = [owner]; emit("accountsChanged", accounts);
      status.textContent = `Mock owner of #${id}: ${owner.slice(0, 8)}…`;
    } catch (error) { status.textContent = String(error); }
  }
  const bar = document.createElement("div");
  bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 10px;background:#ff5a6e;color:#fff;font:12px ui-monospace,monospace";
  bar.innerHTML = `<b>DEV MOCK WALLET — local only, read-only, simulated economy</b>
    <label>Friend <select id="pk-dev-friend">${SAMPLES.map(id => `<option>${id}</option>`).join("")}</select></label>
    <input id="pk-dev-custom" placeholder="other Friend id" size="10"> <button id="pk-dev-use">Use</button>
    <a href="/showroom/" style="color:#fff">Showroom →</a> <span id="pk-dev-status"></span>`;
  const status = bar.querySelector("#pk-dev-status");
  document.addEventListener("DOMContentLoaded", () => {
    document.body.prepend(bar); document.body.style.paddingTop = "36px";
    bar.querySelector("#pk-dev-friend").addEventListener("change", event => choose(event.target.value));
    bar.querySelector("#pk-dev-use").addEventListener("click", () => { const id = bar.querySelector("#pk-dev-custom").value.trim(); if (/^\d+$/.test(id)) choose(id); });
  });
})();
