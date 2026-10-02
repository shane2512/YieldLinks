import { Address, createPublicClient, createWalletClient, http, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hedera, hederaTestnet } from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";

/** Server-only helpers shared by the relayer routes (`/api/claim`, `/api/activate`). */

export const CHAINS = { [hederaTestnet.id]: hederaTestnet, [hedera.id]: hedera } as const;

export const MIRROR_NODES: Record<number, string> = {
  [hederaTestnet.id]: "https://testnet.mirrornode.hedera.com",
  [hedera.id]: "https://mainnet-public.mirrornode.hedera.com",
};

const hits = new Map<string, number[]>();

/**
 * In-memory per-IP limit, counted separately for each `bucket` so that polling one endpoint cannot starve another.
 * Resets on restart; production needs shared storage.
 */
export const rateLimited = (bucket: string, ip: string, perMinute: number) => {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter(t => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > perMinute;
};

export const clientIp = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

/** One relayer key means one nonce sequence, so every send goes through a single queue. */
let queue: Promise<unknown> = Promise.resolve();
export const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
};

/** Hashio's nonce can lag after failed transactions (WRONG_NONCE); the mirror node is authoritative. */
export const mirrorNonce = async (chainId: number, address: Address) => {
  try {
    const res = await fetch(`${MIRROR_NODES[chainId]}/api/v1/accounts/${address}`, { cache: "no-store" });
    const nonce = (await res.json()).ethereum_nonce;
    return typeof nonce === "number" ? nonce : undefined;
  } catch {
    return undefined;
  }
};

export const relayerClients = (chainId: number) => {
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  if (!relayerKey || !isHex(relayerKey)) return null;
  const chain = CHAINS[chainId as keyof typeof CHAINS];
  const transport = http((scaffoldConfig.rpcOverrides as Record<number, string>)[chainId]);
  const account = privateKeyToAccount(relayerKey);
  return {
    chain,
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
  };
};
