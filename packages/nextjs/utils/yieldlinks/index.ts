import { Address, Hex, formatUnits, isHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/** SAUCE (and xSAUCE) use 6 decimals on Hedera. */
export const TOKEN_DECIMALS = 6;

export const YIELD_POLICIES = [
  { value: 0, label: "Recipient", hint: "The gift grows for them" },
  { value: 1, label: "Me", hint: "I keep the yield, they get the principal" },
  { value: 2, label: "Charity", hint: "Yield goes to the contract's charity address" },
] as const;

export const LINK_STATUS = ["None", "Open", "Claimed", "Refunded"] as const;

export const EXPIRY_OPTIONS = [
  { label: "1 day", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
  { label: "30 days", seconds: 30 * 24 * 60 * 60 },
] as const;

/** A throwaway key. Its private half travels in the link's #fragment, so it never reaches a server. */
export const newKeypair = () => {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAccount(privateKey).address };
};

export const buildClaimUrl = (origin: string, privateKey: Hex, chainId: number) =>
  `${origin}/claim#k=${privateKey}&c=${chainId}`;

export const parseClaimHash = (hash: string): { privateKey: Hex; chainId?: number } | null => {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const key = params.get("k");
  if (!key || !isHex(key) || key.length !== 66) return null;
  const chain = Number(params.get("c"));
  return { privateKey: key, chainId: Number.isInteger(chain) && chain > 0 ? chain : undefined };
};

/** EIP-712 payload the contract verifies: binds the claim to this chain, this contract and the recipient. */
export const claimTypedData = (verifyingContract: Address, chainId: number, linkKey: Address, recipient: Address) =>
  ({
    domain: { name: "YieldLinks", version: "1", chainId, verifyingContract },
    types: {
      Claim: [
        { name: "linkKey", type: "address" },
        { name: "recipient", type: "address" },
      ],
    },
    primaryType: "Claim",
    message: { linkKey, recipient },
  }) as const;

export const signClaim = (privateKey: Hex, verifyingContract: Address, chainId: number, recipient: Address) => {
  const account = privateKeyToAccount(privateKey);
  return account.signTypedData(claimTypedData(verifyingContract, chainId, account.address, recipient));
};

export const formatToken = (value: bigint, maxDecimals = TOKEN_DECIMALS) => {
  const [whole, frac = ""] = formatUnits(value, TOKEN_DECIMALS).split(".");
  const trimmed = frac.slice(0, maxDecimals).padEnd(Math.min(maxDecimals, 2), "0");
  return trimmed ? `${Number(whole).toLocaleString()}.${trimmed}` : Number(whole).toLocaleString();
};

/**
 * A raw 32-byte hex key does not say what kind of key it is. Wallet apps that read it as ED25519 (a common default on
 * Hedera) derive a different public key from the same bytes and report "no account found". The DER encoding states
 * "secp256k1 / ECDSA" explicitly, so Hedera wallets such as HashPack read it correctly.
 */
const ECDSA_DER_PREFIX = "3030020100300706052b8104000a04220420";

export const toDerPrivateKey = (privateKey: Hex) => `${ECDSA_DER_PREFIX}${privateKey.slice(2)}`;

/** The raw key without the 0x prefix, as MetaMask and most EVM wallets import it. */
export const toRawHexKey = (privateKey: Hex) => privateKey.slice(2);

type WalletError = { code?: number; shortMessage?: string; message?: string; cause?: unknown };

/** Turns a raw wallet or RPC error into something a person can act on. */
export const describeWalletError = (error: unknown): string => {
  const chain: WalletError[] = [];
  for (let e = error, i = 0; e && typeof e === "object" && i < 6; i++) {
    chain.push(e as WalletError);
    e = (e as WalletError).cause;
  }
  const text = chain.map(e => `${e.shortMessage ?? ""} ${e.message ?? ""}`).join(" ");
  const code = chain.find(e => typeof e.code === "number")?.code;

  if (code === 4001 || /user rejected|user denied|rejected the request/i.test(text)) {
    return "You cancelled the request in your wallet.";
  }
  if (code === 4100 || /not been authorized/i.test(text)) {
    return "Your wallet has not authorized this site for the selected account. In your wallet, disconnect this site, connect again, and pick the account you want to use.";
  }
  if (/chain mismatch|does not match the target chain/i.test(text)) {
    return "Switch your wallet to Hedera Testnet and try again.";
  }
  if (/insufficient (funds|balance)|INSUFFICIENT_PAYER_BALANCE/i.test(text)) {
    return "This account does not have enough HBAR to pay the network fee.";
  }
  const first = chain[0];
  return (first?.shortMessage ?? first?.message ?? "Something went wrong. Please try again.").slice(0, 200);
};

export const hashscanUrl = (chainId: number, path: string) =>
  `https://hashscan.io/${chainId === 295 ? "mainnet" : "testnet"}/${path}`;

/* ---------------------------------------------------------------------------------------------
 * Convenience storage: the sender's browser remembers the links it created so it can show them again.
 * The secret is in the stored URL, so this is as sensitive as the link itself. Nothing is sent anywhere.
 * ------------------------------------------------------------------------------------------- */

export type StoredLink = { linkKey: Address; url: string; createdAt: number };

const STORAGE_KEY = "yieldlinks:links:v1";

export const loadStoredLinks = (): StoredLink[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as StoredLink[];
  } catch {
    return [];
  }
};

export const saveStoredLink = (link: StoredLink) => {
  try {
    const rest = loadStoredLinks().filter(l => l.linkKey !== link.linkKey);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([link, ...rest].slice(0, 100)));
  } catch {
    // Storage can be unavailable (private mode); the link is still shown once after creation.
  }
};
