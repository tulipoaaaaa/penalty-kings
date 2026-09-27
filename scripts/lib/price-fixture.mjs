// Browser-test fixture for the live RF/USD price (games/penalty-kings/game/price.ts).
// The SDK's test harness answers every RPC call locally and rejects reads it does not know, so the
// game's two StateView.getSlot0 reads are answered here with values RECORDED from Robinhood Chain
// (4663) at block 73,793,321 (docs/ADDRESSES.md). This is test-only: the shipped game always reads
// the chain. Any other request falls through to the SDK fixture unchanged.
import { chromium } from "playwright";

const STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
const RECORDED = {
  // RF/WETH pool id → sqrtPriceX96, tick
  "9116440ebd86be5f0b850524a0d52a97399c68027d3590fa3526e1039dda2240": [59977880447322165122003233n, -143730n],
  // WETH/USDG pool id → sqrtPriceX96, tick
  "fcfae8fa0bd6da961bcf5d990f27690932deac4f093e99bf3e871691c6586593": [4129642798072125940494846n, -197248n],
};
const word = value => (value < 0n ? (1n << 256n) + value : value).toString(16).padStart(64, "0");

/** @param {{ fail?: boolean }} options fail: answer the price reads with an RPC error (tests the dash). */
export function installPriceFixture({ fail = false } = {}) {
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args) => {
    const browser = await launch(...args);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...contextArgs) => {
      const context = await newContext(...contextArgs);
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        const goto = page.goto.bind(page);
        // Registered after the SDK fixture (it installs its routes before goto), so it runs first.
        page.goto = async (...gotoArgs) => {
          await page.route("https://rpc.mainnet.chain.robinhood.com/**", async route => {
            const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
            const call = body && !Array.isArray(body) && body.method === "eth_call" ? body.params?.[0] : null;
            const recorded = call && call.to?.toLowerCase() === STATE_VIEW && call.data?.startsWith("0xc815641c") ? RECORDED[call.data.slice(10).toLowerCase()] : null;
            if (!recorded) return route.fallback();
            const json = fail ? { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "price fixture: unavailable" } }
              : { jsonrpc: "2.0", id: body.id, result: `0x${word(recorded[0])}${word(recorded[1])}${word(0n)}${word(500n)}` };
            return route.fulfill({ json, headers: { "access-control-allow-origin": "*" } });
          });
          return goto(...gotoArgs);
        };
        return page;
      };
      return context;
    };
    return browser;
  };
}
