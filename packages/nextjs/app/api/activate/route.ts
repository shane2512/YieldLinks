import { NextResponse } from "next/server";
import { Address, isAddress, parseEther, toEventSelector } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";
import { CHAINS, MIRROR_NODES, clientIp, enqueue, mirrorNonce, rateLimited, relayerClients } from "~~/utils/relayer";
import { ACTIVATION_DRIP_HBAR, ActivationAccount, planActivation } from "~~/utils/yieldlinks/activation";

/**
 * Makes a claim-generated wallet importable in wallet apps. A freshly created Hedera account has no public key on
 * record until it signs a transaction, so wallets that search by key say "no account found". This route sends the
 * little HBAR the account needs to sign that first transaction itself (the browser does the signing).
 *
 * It only funds addresses that a YieldLinks claim paid and whose key is still unrecorded, so it cannot be used as a
 * faucet: after the drip the account has a balance, and after activation it has a key. Either ends eligibility.
 */

const DRIP_GAS_LIMIT = 200_000n;

const mirrorAccount = async (chainId: number, address: Address): Promise<ActivationAccount | null> => {
  const res = await fetch(`${MIRROR_NODES[chainId]}/api/v1/accounts/${address}`, { cache: "no-store" });
  if (!res.ok) return null;
  const account = await res.json();
  return account.account ? { key: account.key ?? null, balanceTinybar: account.balance?.balance ?? 0 } : null;
};

// LinkClaimed(address indexed linkKey, address indexed recipient, uint256 toRecipient, address yieldTo, uint256 yieldAmount)
const LINK_CLAIMED_TOPIC = toEventSelector("LinkClaimed(address,address,uint256,address,uint256)");

// Mirror nodes refuse topic searches without a bounded timestamp range, and cap its width at about 7 days.
// Activation follows a claim by seconds (or minutes on a retry), so the last 6 days is ample.
const SEARCH_WINDOW_SECONDS = 6 * 24 * 60 * 60;

/** True if our YieldLinks contract emitted a `LinkClaimed` event paying this recipient (an indexed topic). */
const paidByClaim = async (chainId: number, contractAddress: Address, to: Address) => {
  const recipientTopic = `0x${to.slice(2).toLowerCase().padStart(64, "0")}`;
  const now = Math.floor(Date.now() / 1000);
  const range = `timestamp=gte:${now - SEARCH_WINDOW_SECONDS}&timestamp=lte:${now + 120}`;
  const url = `${MIRROR_NODES[chainId]}/api/v1/contracts/${contractAddress}/results/logs?topic0=${LINK_CLAIMED_TOPIC}&topic2=${recipientTopic}&${range}&limit=1`;
  const res = await fetch(url, { cache: "no-store" });
  // An error here is not "no claim": surface it instead of letting the client wait forever.
  if (!res.ok) throw new Error(`Mirror node lookup failed (${res.status})`);
  return ((await res.json()).logs ?? []).length > 0;
};

export async function POST(request: Request) {
  // The page polls while the claim reaches the mirror node, so this bucket is more generous than claims.
  if (rateLimited("activate", clientIp(request), 40)) {
    return NextResponse.json({ error: "Too many requests, try again in a minute." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { chainId?: number; recipient?: string } | null;
  const { chainId, recipient } = body ?? {};
  if (!chainId || !(chainId in CHAINS) || !(chainId in deployedContracts)) {
    return NextResponse.json({ error: "Unsupported network." }, { status: 400 });
  }
  if (!recipient || !isAddress(recipient)) {
    return NextResponse.json({ error: "Invalid address." }, { status: 400 });
  }
  const clients = relayerClients(chainId);
  if (!clients) {
    return NextResponse.json(
      { error: "Relayer is not configured. Set RELAYER_PRIVATE_KEY on the server." },
      { status: 503 },
    );
  }

  const contract = deployedContracts[chainId as keyof typeof deployedContracts].YieldLinks;
  let account: ActivationAccount | null;
  let claimed: boolean;
  try {
    [account, claimed] = await Promise.all([
      mirrorAccount(chainId, recipient),
      paidByClaim(chainId, contract.address, recipient),
    ]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Lookup failed" }, { status: 502 });
  }
  const plan = planActivation({ account, paidByClaim: claimed });

  if (plan === "not-eligible") {
    // The claim can take a few seconds to show up on the mirror node; the client retries on this status.
    return NextResponse.json({ state: "pending", error: "Account not ready yet." }, { status: 202 });
  }
  if (plan === "already-active") return NextResponse.json({ state: "active" });
  if (plan === "needs-signature") return NextResponse.json({ state: "funded" });

  try {
    const hash = await enqueue(async () => {
      const nonce = await mirrorNonce(chainId, clients.account.address);
      return clients.walletClient.sendTransaction({
        to: recipient,
        value: parseEther(ACTIVATION_DRIP_HBAR),
        gas: DRIP_GAS_LIMIT,
        type: "legacy",
        nonce,
      });
    });
    await clients.publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 }).catch(() => null);
    return NextResponse.json({ state: "funded", hash });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message.slice(0, 160) : "Could not fund" },
      { status: 502 },
    );
  }
}
