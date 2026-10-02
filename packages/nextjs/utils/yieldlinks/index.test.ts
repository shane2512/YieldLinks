import {
  buildClaimUrl,
  claimTypedData,
  formatToken,
  hashscanUrl,
  newKeypair,
  parseClaimHash,
  signClaim,
} from "./index";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

const CONTRACT = "0x8987B3d66219B08872c9C790E2b234f95DB9E26A";
const RECIPIENT = "0x3ec3FF59e73b6c99ba1A7C00B6930899CDC59b3F";
const OTHER = "0x0F499eC0097CF51142583dDE3505636033342038";

describe("claim links", () => {
  it("round-trips a private key through the URL fragment", () => {
    const { privateKey } = newKeypair();
    const url = buildClaimUrl("https://example.com", privateKey, 296);
    expect(url).toBe(`https://example.com/claim#k=${privateKey}&c=296`);

    const parsed = parseClaimHash(new URL(url).hash);
    expect(parsed).toEqual({ privateKey, chainId: 296 });
  });

  it("keeps the secret out of the query string, so servers never see it", () => {
    const { privateKey } = newKeypair();
    const url = new URL(buildClaimUrl("https://example.com", privateKey, 296));
    expect(url.search).toBe("");
    expect(url.hash).toContain(privateKey);
  });

  it("derives the address the contract stores from the same key", () => {
    const { privateKey, address } = newKeypair();
    expect(privateKeyToAccount(privateKey).address).toBe(address);
  });

  it.each([
    ["empty", ""],
    ["no key", "#c=296"],
    ["truncated key", "#k=0x1234&c=296"],
    ["non-hex key", `#k=0x${"zz".repeat(32)}&c=296`],
    ["key without 0x", `#k=${"ab".repeat(32)}&c=296`],
  ])("rejects a malformed link: %s", (_label, hash) => {
    expect(parseClaimHash(hash)).toBeNull();
  });

  it("treats a missing or invalid chain id as unspecified", () => {
    const { privateKey } = newKeypair();
    expect(parseClaimHash(`#k=${privateKey}`)?.chainId).toBeUndefined();
    expect(parseClaimHash(`#k=${privateKey}&c=abc`)?.chainId).toBeUndefined();
    expect(parseClaimHash(`#k=${privateKey}&c=-1`)?.chainId).toBeUndefined();
  });
});

describe("claim signatures", () => {
  const { privateKey, address } = newKeypair();

  it("recovers to the link key, which is what YieldLinks.claim checks", async () => {
    const signature = await signClaim(privateKey, CONTRACT, 296, RECIPIENT);
    const signer = await recoverTypedDataAddress({ ...claimTypedData(CONTRACT, 296, address, RECIPIENT), signature });
    expect(signer).toBe(address);
  });

  it("is bound to the recipient: a swapped recipient recovers to a different address", async () => {
    const signature = await signClaim(privateKey, CONTRACT, 296, RECIPIENT);
    const signer = await recoverTypedDataAddress({ ...claimTypedData(CONTRACT, 296, address, OTHER), signature });
    expect(signer).not.toBe(address);
  });

  it("is bound to the chain and the contract", async () => {
    const signature = await signClaim(privateKey, CONTRACT, 296, RECIPIENT);
    const wrongChain = await recoverTypedDataAddress({
      ...claimTypedData(CONTRACT, 295, address, RECIPIENT),
      signature,
    });
    const wrongContract = await recoverTypedDataAddress({
      ...claimTypedData(OTHER, 296, address, RECIPIENT),
      signature,
    });
    expect(wrongChain).not.toBe(address);
    expect(wrongContract).not.toBe(address);
  });

  it("uses the exact domain and type the contract declares", () => {
    // Mirrors YieldLinks.sol: EIP712("YieldLinks", "1") and CLAIM_TYPEHASH = Claim(address linkKey,address recipient).
    const data = claimTypedData(CONTRACT, 296, address, RECIPIENT);
    expect(data.domain).toEqual({ name: "YieldLinks", version: "1", chainId: 296, verifyingContract: CONTRACT });
    expect(data.primaryType).toBe("Claim");
    expect(data.types.Claim).toEqual([
      { name: "linkKey", type: "address" },
      { name: "recipient", type: "address" },
    ]);
  });
});

describe("formatting", () => {
  it.each([
    [4_999_999n, 6, "4.999999"],
    [5_000_000n, 6, "5.00"],
    [1_234_567_890n, 4, "1,234.5678"],
    [0n, 6, "0.00"],
    [1n, 6, "0.000001"],
  ])("formatToken(%s, %s) = %s", (value, decimals, expected) => {
    expect(formatToken(value, decimals)).toBe(expected);
  });

  it("links to the right HashScan network", () => {
    expect(hashscanUrl(296, "account/0.0.1")).toBe("https://hashscan.io/testnet/account/0.0.1");
    expect(hashscanUrl(295, "account/0.0.1")).toBe("https://hashscan.io/mainnet/account/0.0.1");
  });
});
