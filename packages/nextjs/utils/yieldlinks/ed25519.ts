import { ed25519 } from "@noble/curves/ed25519";
import { Address, Hex, bytesToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Wallets generated on the claim page are ED25519 Hedera accounts, the key type HashPack creates and imports by
 * default. (A bare EVM address can only ever become an ECDSA account, which HashPack's private-key import did not find
 * when we tried it, so the relayer creates a real ED25519 account up front instead.)
 */

/** Fixed DER prefix for an ED25519 private key; prefix plus the 32-byte key is the 96-character form HashPack accepts. */
const ED25519_DER_PREFIX = "302e020100300506032b657004220420";

export type GeneratedWallet = {
  /** 64 hex characters, no 0x prefix: what HashPack's import field and most tools take. */
  privateKey: string;
  /** 64 hex characters. Sent to the relayer so it can create the account; never secret. */
  publicKey: string;
  /** 96 characters: the DER encoding, for Hedera SDK and CLI tools. */
  privateKeyDer: string;
};

export const newEd25519Wallet = (): GeneratedWallet => {
  const secret = ed25519.utils.randomPrivateKey();
  const privateKey = bytesToHex(secret).slice(2);
  return {
    privateKey,
    publicKey: bytesToHex(ed25519.getPublicKey(secret)).slice(2),
    privateKeyDer: `${ED25519_DER_PREFIX}${privateKey}`,
  };
};

/** The EVM-style address of an existing Hedera account, which is its account number in hex ("long-zero" form). */
export const longZeroAddress = (accountId: string): Address => {
  const match = /^0\.0\.(\d+)$/.exec(accountId);
  if (!match) throw new Error(`Unsupported account id: ${accountId}`);
  return `0x${BigInt(match[1]).toString(16).padStart(40, "0")}`;
};

/**
 * What the link holder signs to ask for an account: proof that they hold an open link, so the relayer cannot be
 * asked to create accounts for strangers. Bound to the public key so it cannot be reused for a different account.
 */
export const createAccountTypedData = (
  verifyingContract: Address,
  chainId: number,
  linkKey: Address,
  publicKey: string,
) =>
  ({
    domain: { name: "YieldLinks", version: "1", chainId, verifyingContract },
    types: {
      CreateAccount: [
        { name: "linkKey", type: "address" },
        { name: "publicKey", type: "bytes" },
      ],
    },
    primaryType: "CreateAccount",
    message: { linkKey, publicKey: `0x${publicKey}` as Hex },
  }) as const;

export const signCreateAccount = (
  linkPrivateKey: Hex,
  verifyingContract: Address,
  chainId: number,
  publicKey: string,
) => {
  const account = privateKeyToAccount(linkPrivateKey);
  return account.signTypedData(createAccountTypedData(verifyingContract, chainId, account.address, publicKey));
};
