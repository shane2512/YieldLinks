"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Address, Hex, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { usePublicClient } from "wagmi";
import { CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import scaffoldConfig from "~~/scaffold.config";
import { hashscanUrl, toDerPrivateKey, toRawHexKey } from "~~/utils/yieldlinks";
import { MIN_ACTIVATION_BALANCE_TINYBAR } from "~~/utils/yieldlinks/activation";

type ClaimSuccessProps = {
  hash: string;
  recipient: Address;
  /** Set only when the claim page generated this wallet, so we hold its key and can activate the account. */
  generated?: { address: Address; privateKey: Hex };
};

type Activation = "working" | "done" | "failed";

// A plain self-transfer; its only job is to be signed by the account so its public key is recorded.
const ACTIVATION_TX_GAS = 100_000n;
const POLL_MS = 3_000;
const MAX_POLLS = 12;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const ClaimSuccess = ({ hash, recipient, generated }: ClaimSuccessProps) => {
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const [activation, setActivation] = useState<Activation | null>(generated ? "working" : null);
  const [detail, setDetail] = useState("Preparing your account…");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const started = useRef(false);

  /**
   * A new Hedera account has no public key on record until it signs something, so wallet apps that look accounts up
   * by key say "no account found". Fund it a little (relayer), then sign one tiny transaction with its own key.
   */
  const activate = useCallback(async () => {
    if (!generated || !publicClient) return;
    setActivation("working");
    try {
      let state = "pending";
      for (let i = 0; i < MAX_POLLS && state === "pending"; i++) {
        setDetail("Preparing your account…");
        const res = await fetch("/api/activate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chainId: targetNetwork.id, recipient }),
        });
        const body = await res.json();
        if (res.status === 202) await sleep(POLL_MS);
        else if (!res.ok) throw new Error(body.error ?? "Could not prepare the account");
        else state = body.state;
      }
      if (state === "pending") throw new Error("The network is still catching up");

      if (state !== "active") {
        setDetail("Waiting for the network to credit your account…");
        for (let i = 0; i < MAX_POLLS; i++) {
          const balance = await publicClient.getBalance({ address: recipient });
          // JSON-RPC balances use 18 decimals; tinybar has 8.
          if (balance / 10n ** 10n >= BigInt(MIN_ACTIVATION_BALANCE_TINYBAR)) break;
          await sleep(2_000);
        }

        setDetail("Registering your account key…");
        const account = privateKeyToAccount(generated.privateKey);
        const rpcUrl = (scaffoldConfig.rpcOverrides as Record<number, string>)[targetNetwork.id];
        const walletClient = createWalletClient({ account, chain: targetNetwork, transport: http(rpcUrl) });
        const txHash = await walletClient.sendTransaction({
          to: recipient,
          value: 0n,
          gas: ACTIVATION_TX_GAS,
          type: "legacy",
          gasPrice: await publicClient.getGasPrice(),
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      }

      const mirror =
        targetNetwork.id === 295
          ? "https://mainnet-public.mirrornode.hedera.com"
          : "https://testnet.mirrornode.hedera.com";
      const account = await fetch(`${mirror}/api/v1/accounts/${recipient}`)
        .then(r => r.json())
        .catch(() => null);
      setAccountId(account?.account ?? null);
      setActivation("done");
    } catch {
      setActivation("failed");
    }
  }, [generated, publicClient, recipient, targetNetwork]);

  useEffect(() => {
    if (generated && !started.current) {
      started.current = true;
      void activate();
    }
  }, [generated, activate]);

  const copy = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const networkName = targetNetwork.id === 295 ? "Mainnet" : "Testnet";

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="badge badge-success badge-lg gap-1">
        <CheckIcon className="h-4 w-4" /> Claimed
      </div>
      <p className="text-lg font-medium">The gift is in your Hedera account.</p>
      <p className="text-sm text-base-content/70 max-w-md break-all">
        Delivered to <span className="font-mono">{recipient}</span>. If that address had no account yet, the claim
        created one and associated the token for you.
      </p>
      <div className="flex gap-4 text-sm">
        <a
          className="link"
          href={hashscanUrl(targetNetwork.id, `transaction/${hash}`)}
          target="_blank"
          rel="noreferrer"
        >
          View transaction
        </a>
        <a
          className="link"
          href={hashscanUrl(targetNetwork.id, `account/${recipient}`)}
          target="_blank"
          rel="noreferrer"
        >
          View account
        </a>
      </div>

      {generated && (
        <div className="w-full rounded-xl border border-base-300 p-4 text-left flex flex-col gap-3">
          <div className="font-semibold text-sm">Use this account in a wallet app</div>

          {activation === "working" && (
            <div className="flex items-center gap-2 text-sm text-base-content/70">
              <span className="loading loading-spinner loading-sm" /> {detail}
            </div>
          )}

          {activation === "failed" && (
            <div className="alert alert-warning text-sm flex-col sm:flex-row">
              <span>We could not finish preparing the account. Your gift is safe.</span>
              <button className="btn btn-sm" onClick={() => void activate()}>
                Try again
              </button>
            </div>
          )}

          {activation === "done" && generated && (
            <>
              <p className="text-sm text-base-content/70">
                Your account is ready to import. Wallet apps find accounts by key, and yours now has one on record.
              </p>
              <div className="flex flex-col gap-2">
                {accountId && (
                  <CopyRow id="account" label="Account ID" value={accountId} copied={copied} onCopy={copy} />
                )}
                <CopyRow
                  id="hex"
                  label="Private key, 64 characters (HashPack and MetaMask)"
                  value={toRawHexKey(generated.privateKey)}
                  copied={copied}
                  onCopy={copy}
                />
                <CopyRow
                  id="der"
                  label="Private key, DER format (Hedera SDK and CLI tools only)"
                  value={toDerPrivateKey(generated.privateKey)}
                  copied={copied}
                  onCopy={copy}
                />
              </div>
              <ol className="list-decimal pl-5 text-sm space-y-1 text-base-content/80">
                <li>
                  In HashPack, choose Add account, then Import, and select the <strong>{networkName}</strong> network.
                </li>
                <li>
                  Paste the <strong>64-character</strong> key. HashPack&apos;s field takes 64 or 96 characters, so the
                  longer DER key is not for it.
                </li>
                <li>HashPack should list the account above. MetaMask takes the same 64-character key.</li>
              </ol>
              <p className="text-xs text-base-content/50">
                Still &quot;no accounts found&quot;? Check the wallet is on {networkName}, that this key is from this
                page after it said &quot;ready to import&quot;, and wait a minute. Keep your private key private: anyone
                who has it controls the account.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
};

type CopyRowProps = {
  id: string;
  label: string;
  value: string;
  copied: string | null;
  onCopy: (id: string, value: string) => void;
};

const CopyRow = ({ id, label, value, copied, onCopy }: CopyRowProps) => (
  <div className="rounded-lg bg-base-200 p-2">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-base-content/60">{label}</span>
      <button
        className="link link-primary inline-flex items-center gap-1 text-xs"
        onClick={() => void onCopy(id, value)}
      >
        {copied === id ? <CheckIcon className="h-3 w-3" /> : <ClipboardDocumentIcon className="h-3 w-3" />}
        {copied === id ? "Copied" : "Copy"}
      </button>
    </div>
    <div className="font-mono text-xs break-all">{value}</div>
  </div>
);
