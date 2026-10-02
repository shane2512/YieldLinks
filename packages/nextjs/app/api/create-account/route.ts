import { NextResponse } from "next/server";
import { AccountCreateTransaction, AccountId, Client, Hbar, PrivateKey, PublicKey } from "@hiero-ledger/sdk";
import { Address, isAddress, isHex, recoverTypedDataAddress } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";
import { CHAINS, MIRROR_NODES, clientIp, rateLimited, relayerClients } from "~~/utils/relayer";
import { createAccountTypedData, longZeroAddress } from "~~/utils/yieldlinks/ed25519";

/**
 * Creates the Hedera account for a wallet generated on the claim page.
 *
 * The wallet is an ED25519 account, the type HashPack imports by default. It has to exist before the claim so the claim
 * can pay it by account, and creating it with its key means wallet apps can find it straight away.
 *
 * Only a holder of an open link can ask for one: the request carries a signature by the link key over the new public
 * key, and the link must be open on-chain. One link gets one account (retries return the same account), and requests
 * are rate limited, so this cannot be used to create accounts in bulk.
 */

/** HBAR the new account starts with, so its owner can pay for a first transaction. */
const WELCOME_HBAR = 0.1;
const LINK_STATUS_OPEN = 1;

const createdByLink = new Map<string, { accountId: string }>();

type PublicClient = NonNullable<ReturnType<typeof relayerClients>>["publicClient"];

/**
 * A new account reaches consensus before the RPC node that simulates and executes the claim can see it. Claiming too
 * early makes Hedera treat the address as an unknown alias and revert with INVALID_ALIAS_KEY, so wait until the RPC
 * reports the welcome balance.
 */
const waitUntilVisible = async (publicClient: PublicClient, address: Address) => {
  for (let i = 0; i < 15; i++) {
    const balance = await publicClient.getBalance({ address }).catch(() => 0n);
    if (balance > 0n) return;
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
};

const relayerAccountId = async (chainId: number, evmAddress: Address) => {
  const res = await fetch(`${MIRROR_NODES[chainId]}/api/v1/accounts/${evmAddress}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Relayer account not found on the network");
  const account = (await res.json()).account;
  if (typeof account !== "string") throw new Error("Relayer account not found on the network");
  return account;
};

export async function POST(request: Request) {
  if (rateLimited("create-account", clientIp(request), 10)) {
    return NextResponse.json({ error: "Too many requests, try again in a minute." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as {
    chainId?: number;
    linkKey?: string;
    publicKey?: string;
    signature?: string;
  } | null;
  const { chainId, linkKey, publicKey, signature } = body ?? {};
  if (!chainId || !(chainId in CHAINS) || !(chainId in deployedContracts)) {
    return NextResponse.json({ error: "Unsupported network." }, { status: 400 });
  }
  if (
    !linkKey ||
    !isAddress(linkKey) ||
    !publicKey ||
    !/^[0-9a-f]{64}$/.test(publicKey) ||
    !signature ||
    !isHex(signature)
  ) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const clients = relayerClients(chainId);
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  if (!clients || !relayerKey) {
    return NextResponse.json(
      { error: "Relayer is not configured. Set RELAYER_PRIVATE_KEY on the server." },
      { status: 503 },
    );
  }

  const contract = deployedContracts[chainId as keyof typeof deployedContracts].YieldLinks;

  // 1. The requester must hold the link key.
  const signer = await recoverTypedDataAddress({
    ...createAccountTypedData(contract.address, chainId, linkKey, publicKey),
    signature,
  }).catch(() => null);
  if (signer?.toLowerCase() !== linkKey.toLowerCase()) {
    return NextResponse.json({ error: "InvalidSignature" }, { status: 400 });
  }

  // 2. The link must be open on-chain and not expired.
  const link = await clients.publicClient.readContract({
    address: contract.address,
    abi: contract.abi,
    functionName: "links",
    args: [linkKey],
  });
  const [, expiry, status] = link;
  if (status !== LINK_STATUS_OPEN || BigInt(Math.floor(Date.now() / 1000)) >= expiry) {
    return NextResponse.json({ error: "LinkNotOpen" }, { status: 400 });
  }

  // 3. One account per link: a retry gets the account it already created.
  const existing = createdByLink.get(linkKey.toLowerCase());
  if (existing) {
    return NextResponse.json({ accountId: existing.accountId, evmAddress: longZeroAddress(existing.accountId) });
  }

  const hederaClient = chainId === 295 ? Client.forMainnet() : Client.forTestnet();
  try {
    const operator = await relayerAccountId(chainId, clients.account.address);
    hederaClient.setOperator(AccountId.fromString(operator), PrivateKey.fromStringECDSA(relayerKey));

    const response = await new AccountCreateTransaction()
      .setKeyWithoutAlias(PublicKey.fromStringED25519(publicKey))
      .setInitialBalance(new Hbar(WELCOME_HBAR))
      // Unlimited automatic token associations so the claim can pay the account in SAUCE without a separate step.
      .setMaxAutomaticTokenAssociations(-1)
      .execute(hederaClient);
    const receipt = await response.getReceipt(hederaClient);
    if (!receipt.accountId) throw new Error("Account creation returned no account id");

    const accountId = receipt.accountId.toString();
    createdByLink.set(linkKey.toLowerCase(), { accountId });
    const evmAddress = longZeroAddress(accountId);
    await waitUntilVisible(clients.publicClient, evmAddress);
    return NextResponse.json({ accountId, evmAddress });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message.slice(0, 160) : "Could not create the account" },
      { status: 502 },
    );
  } finally {
    hederaClient.close();
  }
}
