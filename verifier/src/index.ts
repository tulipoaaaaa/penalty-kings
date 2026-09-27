/**
 * Cloudflare Worker entry for the Penalty Kings Skill Cup referee.
 *
 * Secrets (wrangler secret put): WEEK_SECRET (64 hex chars), SIGNING_KEY (ECDSA P-256 private JWK).
 * Vars: WEEK, RPC_URL (Robinhood mainnet), SKILL_CUP (contract address), ALLOWED_ORIGIN.
 * KV binding: ENTRIES.
 *
 * Routes: GET /week → { week, secretHash, publicKey }, POST /entry { txHash }, POST /kick,
 *         GET /entry/:id, GET /leaderboard.
 */
import { createPublicClient, http, parseAbi, parseEventLogs, type Hex } from "viem";
import { createReferee, RefereeError, type Entry, type Store, type Chain } from "./core.ts";

type KV = { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void>; list(options: { prefix: string }): Promise<{ keys: { name: string }[] }> };
export type Env = { WEEK_SECRET: string; SIGNING_KEY: string; WEEK: string; RPC_URL: string; SKILL_CUP: string; ALLOWED_ORIGIN: string; ENTRIES: KV };

const fromHex = (value: string) => Uint8Array.from(value.replace(/^0x/, "").match(/../g)!.map(byte => parseInt(byte, 16)));
const ENTERED = parseAbi(["event Entered(uint256 indexed entryId, uint256 indexed friendId, address indexed player, uint256 week)"]);

function kvStore(kv: KV): Store {
  return {
    async getEntry(id) { const raw = await kv.get(`entry:${id}`); return raw ? (JSON.parse(raw) as Entry) : null; },
    async putEntry(entry) {
      await kv.put(`entry:${entry.id}`, JSON.stringify(entry));
      await kv.put(`week:${entry.week}:${entry.id}`, String(entry.id));
    },
    async weekEntries(week) {
      const { keys } = await kv.list({ prefix: `week:${week}:` });
      const found = await Promise.all(keys.map(key => kv.get(`entry:${key.name.split(":")[2]}`)));
      return found.filter((raw): raw is string => Boolean(raw)).map(raw => JSON.parse(raw) as Entry);
    },
  };
}

export function rpcChain(rpcUrl: string, skillCup: string): Chain {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    async entryFromTx(hash) {
      const receipt = await client.getTransactionReceipt({ hash: hash as Hex }).catch(() => null);
      if (!receipt || receipt.status !== "success") return null;
      const logs = parseEventLogs({ abi: ENTERED, logs: receipt.logs.filter(log => log.address.toLowerCase() === skillCup.toLowerCase()), strict: true });
      if (logs.length !== 1) return null;
      const { entryId, friendId, player, week } = logs[0].args;
      return { entryId: Number(entryId), friendId: friendId.toString(), player, week: Number(week) };
    },
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = { "access-control-allow-origin": env.ALLOWED_ORIGIN || "*", "access-control-allow-headers": "content-type", "content-type": "application/json" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
    try {
      const signingKey = await crypto.subtle.importKey("jwk", JSON.parse(env.SIGNING_KEY), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      const store = kvStore(env.ENTRIES);
      const referee = createReferee({ secret: fromHex(env.WEEK_SECRET), week: Number(env.WEEK), store, chain: rpcChain(env.RPC_URL, env.SKILL_CUP), signingKey });
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/week") {
        const { d: _private, ...publicJwk } = JSON.parse(env.SIGNING_KEY);
        return json({ week: Number(env.WEEK), secretHash: await referee.hash(), publicKey: { ...publicJwk, key_ops: ["verify"] }, skillCup: env.SKILL_CUP });
      }
      if (request.method === "GET" && url.pathname === "/leaderboard") return json(await referee.leaderboard());
      if (request.method === "POST" && url.pathname === "/entry") return json(await referee.enter(await request.json()));
      if (request.method === "POST" && url.pathname === "/kick") return json(await referee.kick(await request.json()));
      if (request.method === "GET" && url.pathname.startsWith("/entry/")) {
        const entry = await store.getEntry(Number(url.pathname.slice(7)));
        return entry ? json(entry) : json({ error: "Unknown entry." }, 404);
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      if (error instanceof RefereeError) return json({ error: error.message }, error.status);
      return json({ error: "Referee error." }, 500);
    }
  },
};
