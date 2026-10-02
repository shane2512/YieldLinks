import { createAccountTypedData, longZeroAddress, newEd25519Wallet, signCreateAccount } from "./ed25519";
import { newKeypair } from "./index";
import { PrivateKey } from "@hiero-ledger/sdk";
import { recoverTypedDataAddress } from "viem";
import { describe, expect, it } from "vitest";

const CONTRACT = "0x8987B3d66219B08872c9C790E2b234f95DB9E26A";

describe("generated ED25519 wallets", () => {
  it("produces the 64, 64 and 96 character forms HashPack's import field expects", () => {
    const wallet = newEd25519Wallet();
    expect(wallet.privateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(wallet.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(wallet.privateKeyDer).toHaveLength(96);
  });

  it("derives the public key and DER encoding exactly as the Hedera SDK does", () => {
    const wallet = newEd25519Wallet();
    const sdk = PrivateKey.fromStringED25519(wallet.privateKey);
    expect(wallet.publicKey).toBe(sdk.publicKey.toStringRaw());
    expect(wallet.privateKeyDer).toBe(sdk.toStringDer());
  });

  it("a wallet app that reads the DER key gets the same public key the account is created with", () => {
    const wallet = newEd25519Wallet();
    expect(PrivateKey.fromStringDer(wallet.privateKeyDer).publicKey.toStringRaw()).toBe(wallet.publicKey);
  });

  it("never repeats a key", () => {
    expect(newEd25519Wallet().privateKey).not.toBe(newEd25519Wallet().privateKey);
  });
});

describe("longZeroAddress", () => {
  it("turns an account number into the address Hedera uses for that account", () => {
    expect(longZeroAddress("0.0.10829035")).toBe(
      "0x0000000000000000000000000000000000a5426b".replace("a5426b", (10829035).toString(16)),
    );
    expect(longZeroAddress("0.0.1")).toBe("0x0000000000000000000000000000000000000001");
    expect(longZeroAddress("0.0.1")).toHaveLength(42);
  });

  it.each(["", "0.0.abc", "1.2.3", "0.1.5", "10829035", "0.0.-1"])("rejects %s", bad => {
    expect(() => longZeroAddress(bad)).toThrow();
  });
});

describe("account-creation proof", () => {
  const link = newKeypair();
  const wallet = newEd25519Wallet();

  it("recovers to the link key, proving the requester holds the link", async () => {
    const signature = await signCreateAccount(link.privateKey, CONTRACT, 296, wallet.publicKey);
    const signer = await recoverTypedDataAddress({
      ...createAccountTypedData(CONTRACT, 296, link.address, wallet.publicKey),
      signature,
    });
    expect(signer).toBe(link.address);
  });

  it("is bound to the public key: it cannot be replayed to create a different account", async () => {
    const signature = await signCreateAccount(link.privateKey, CONTRACT, 296, wallet.publicKey);
    const other = newEd25519Wallet();
    const signer = await recoverTypedDataAddress({
      ...createAccountTypedData(CONTRACT, 296, link.address, other.publicKey),
      signature,
    });
    expect(signer).not.toBe(link.address);
  });

  it("is bound to the chain", async () => {
    const signature = await signCreateAccount(link.privateKey, CONTRACT, 296, wallet.publicKey);
    const signer = await recoverTypedDataAddress({
      ...createAccountTypedData(CONTRACT, 295, link.address, wallet.publicKey),
      signature,
    });
    expect(signer).not.toBe(link.address);
  });
});
