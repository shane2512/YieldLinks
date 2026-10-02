import { NextResponse } from "next/server";
import { BaseError, ContractFunctionRevertedError, isAddress, isHex } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";
import { CHAINS, clientIp, enqueue, mirrorNonce, rateLimited, relayerClients } from "~~/utils/relayer";

/**
 * Gas-paying relayer. A claimant needs no HBAR: they sign a claim with the link key in the browser and this
 * route submits it. It can only ever call `claim` on the deployed YieldLinks contract, and it simulates first
 * so a bad claim costs nothing.
 */

// Claims unstake from SaucerSwap and airdrop through HTS, which is gas-heavy. Capped so a relayer cannot be drained.
const CLAIM_GAS_LIMIT = 3_000_000n;

const revertName = (error: unknown) => {
  if (error instanceof BaseError) {
    const reverted = error.walk(e => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) return reverted.data?.errorName ?? reverted.shortMessage;
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : "Unknown error";
};

export async function POST(request: Request) {
  if (rateLimited("claim", clientIp(request), 10)) {
    return NextResponse.json({ error: "Too many claims, try again in a minute." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as {
    chainId?: number;
    linkKey?: string;
    recipient?: string;
    signature?: string;
  } | null;
  const { chainId, linkKey, recipient, signature } = body ?? {};
  if (!chainId || !(chainId in CHAINS) || !(chainId in deployedContracts)) {
    return NextResponse.json({ error: "Unsupported network." }, { status: 400 });
  }
  if (!linkKey || !isAddress(linkKey) || !recipient || !isAddress(recipient) || !signature || !isHex(signature)) {
    return NextResponse.json({ error: "Invalid claim payload." }, { status: 400 });
  }

  const clients = relayerClients(chainId);
  if (!clients) {
    return NextResponse.json(
      { error: "Relayer is not configured. Set RELAYER_PRIVATE_KEY on the server." },
      { status: 503 },
    );
  }

  const contract = deployedContracts[chainId as keyof typeof deployedContracts].YieldLinks;
  const args = [linkKey, recipient, signature] as const;

  try {
    await clients.publicClient.simulateContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "claim",
      args,
      account: clients.account,
      gas: CLAIM_GAS_LIMIT,
    });
  } catch (error) {
    return NextResponse.json({ error: revertName(error) }, { status: 400 });
  }

  try {
    const result = await enqueue(async () => {
      const nonce = await mirrorNonce(chainId, clients.account.address);
      const hash = await clients.walletClient.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "claim",
        args,
        gas: CLAIM_GAS_LIMIT,
        type: "legacy",
        nonce,
      });
      const receipt = await clients.publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 }).catch(() => null);
      return { hash, status: receipt?.status ?? "pending" };
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: revertName(error) }, { status: 502 });
  }
}
