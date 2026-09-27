/**
 * Cloudflare Worker entry for the Penalty Kings Skill Cup referee.
 *
 * Secrets (wrangler secret put): WEEK_SECRET (64 hex chars), SIGNING_KEY (ECDSA P-256 private JWK).
 * Vars: WEEK (week number), RPC_URL (Robinhood mainnet), ALLOWED_ORIGIN.
 * KV binding: ENTRIES.
 *
 * Routes: GET /week → { week, secretHash, publicKey }, POST /entry, POST /kick, GET /entry/:id.
 */
import { createPublicClient, http, verifyMessage, type Address, type Hex } from "viem";
import { readGenerationEligibility } from "@rarefriends/friendsdk/identity";
import { createReferee, RefereeError, type Entry, type Store, type Chain } from "./core.ts";

type KV = { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void>; list(options: { prefix: string }): Promise<{ keys: { name: string }[] }> };
export type Env = { WEEK_SECRET: string; SIGNING_KEY: string; WEEK: string; RPC_URL: string; ALLOWED_ORIGIN: string; ENTRIES: KV };

const fromHex = (value: string) => Uint8Array.from(value.replace(/^0x/, "").match(/../g)!.map(byte => parseInt(byte, 16)));

function kvStore(kv: KV): Store {
  return {
    // Time-ordered ids: earlier entry wins ties. Collisions are avoided by the random low digits.
    async nextEntryId() { return Date.now() * 1000 + Math.floor(Math.random() * 1000); },
    async getEntry(id) { const raw = await kv.get(`entry:${id}`); return raw ? (JSON.parse(raw) as Entry) : null; },
    async putEntry(entry) {
      await kv.put(`entry:${entry.id}`, JSON.stringify(entry));
      await kv.put(`friend:${entry.week}:${entry.friendId}:${entry.id}`, String(entry.createdAt));
    },
    async friendEntries(week, friendId) {
      const { keys } = await kv.list({ prefix: `friend:${week}:${friendId}:` });
      return Promise.all(keys.map(async key => Number(await kv.get(key.name))));
    },
  };
}

function rpcChain(rpcUrl: string): Chain {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    async friend(friendId) {
      const result = await readGenerationEligibility(client as never, friendId);
      return { owner: result.owner, generation: result.hardwired ? result.generation : 0 };
    },
    verifySignature: (owner, message, signature) => verifyMessage({ address: owner as Address, message, signature: signature as Hex }),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = { "access-control-allow-origin": env.ALLOWED_ORIGIN || "*", "access-control-allow-headers": "content-type", "content-type": "application/json" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
    try {
      const signingKey = await crypto.subtle.importKey("jwk", JSON.parse(env.SIGNING_KEY), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      const referee = createReferee({ secret: fromHex(env.WEEK_SECRET), week: Number(env.WEEK), store: kvStore(env.ENTRIES), chain: rpcChain(env.RPC_URL), signingKey });
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/week") {
        const { d: _private, ...publicJwk } = JSON.parse(env.SIGNING_KEY);
        return json({ week: Number(env.WEEK), secretHash: await referee.hash(), publicKey: { ...publicJwk, key_ops: ["verify"] } });
      }
      if (request.method === "POST" && url.pathname === "/entry") return json(await referee.enter(await request.json()));
      if (request.method === "POST" && url.pathname === "/kick") return json(await referee.kick(await request.json()));
      if (request.method === "GET" && url.pathname.startsWith("/entry/")) {
        const entry = await kvStore(env.ENTRIES).getEntry(Number(url.pathname.slice(7)));
        return entry ? json(entry) : json({ error: "Unknown entry." }, 404);
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      if (error instanceof RefereeError) return json({ error: error.message }, error.status);
      return json({ error: "Referee error." }, 500);
    }
  },
};
