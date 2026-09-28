/** Read-only access to Robinhood Chain for the real providers (Privy, Injected): identity reads and owned Friends. */
import { createPublicClient, defineChain, http } from "viem";
import { ROBINHOOD_CHAIN } from "./chain.ts";
import type { FriendRef, Hex, IdentityReadClient } from "./types.ts";

export const robinhood = defineChain({
  id: ROBINHOOD_CHAIN.id, name: ROBINHOOD_CHAIN.name, nativeCurrency: ROBINHOOD_CHAIN.nativeCurrency,
  rpcUrls: { default: { http: [ROBINHOOD_CHAIN.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: ROBINHOOD_CHAIN.explorer } },
});

let shared: IdentityReadClient | null = null;
/** One read-only public client (no key, no signer). */
export function realPublicClient(): IdentityReadClient {
  shared ??= createPublicClient({ chain: robinhood, transport: http(ROBINHOOD_CHAIN.rpcUrl) }) as unknown as IdentityReadClient;
  return shared;
}

export type ChainFriendsReader = (address: Hex) => Promise<FriendRef[]>;

/** The SDK's own owned-Friend discovery (account-filtered Transfer logs + fresh ownership/generation reads). */
export const readChainFriends: ChainFriendsReader = async address => {
  const { readOwnedFriends } = await import("@rarefriends/friendsdk/owned");
  const result = await readOwnedFriends(realPublicClient() as never, address);
  return result.friends.map(friend => ({
    id: friend.id.toString(), label: `Friend #${friend.id}`, relation: "owned" as const,
    hardwired: true, fixture: false, simulated: false,
  }));
};
