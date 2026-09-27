// Local server for the referee Worker (tests and local development). Same fetch handler as the
// deployed Worker, with an in-memory KV. Secrets are generated per process and never written out.
//   node --experimental-strip-types verifier/dev-server.ts --port 8787 --rpc <url> --skill-cup <address> --origin <origin>
import { createServer } from "node:http";
import worker from "./src/index.ts";

const args = Object.fromEntries(process.argv.slice(2).reduce<[string, string][]>((pairs, value, index, list) => (value.startsWith("--") ? [...pairs, [value.slice(2), list[index + 1]]] : pairs), []));
const store = new Map<string, string>();
const kv = {
  async get(key: string) { return store.get(key) ?? null; },
  async put(key: string, value: string) { store.set(key, value); },
  async list({ prefix }: { prefix: string }) { return { keys: [...store.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })) }; },
};
const secret = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const env = { WEEK_SECRET: secret, SIGNING_KEY: JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey)), WEEK: args.week ?? "1", RPC_URL: args.rpc, SKILL_CUP: args["skill-cup"], ALLOWED_ORIGIN: args.origin ?? "*", ENTRIES: kv };

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" ? undefined : Buffer.concat(chunks) });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(Number(args.port ?? 8787), "127.0.0.1", () => console.log(`referee dev server on :${args.port ?? 8787}`));
