"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { erc20Abi, parseUnits } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
} from "~~/hooks/scaffold-hbar";
import { notification } from "~~/utils/scaffold-hbar";
import {
  EXPIRY_OPTIONS,
  TOKEN_DECIMALS,
  YIELD_POLICIES,
  buildClaimUrl,
  formatToken,
  hashscanUrl,
  newKeypair,
  saveStoredLink,
} from "~~/utils/yieldlinks";

// createLink associates, transfers and stakes in one call; HTS precompile calls are not estimated reliably.
const CREATE_GAS_LIMIT = 2_000_000n;

type Created = { url: string; txHash: string };

export const CreateLinkForm = () => {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });

  const [amount, setAmount] = useState("5");
  const [expiry, setExpiry] = useState<number>(EXPIRY_OPTIONS[1].seconds);
  const [policy, setPolicy] = useState<number>(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: sauce } = useScaffoldReadContract({ contractName: "SauceStakingSource", functionName: "SAUCE" });
  const { data: source } = useDeployedContractInfo({ contractName: "SauceStakingSource" });

  const { data: balance } = useReadContract({
    address: sauce,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!sauce && !!address, refetchInterval: 15_000 },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: sauce,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && source ? [address, source.address] : undefined,
    query: { enabled: !!sauce && !!address && !!source },
  });

  const { writeContractAsync: writeToken } = useWriteContract();
  const { writeContractAsync: writeLinks } = useScaffoldWriteContract({ contractName: "YieldLinks" });

  let parsed: bigint | null = null;
  try {
    parsed = amount ? parseUnits(amount, TOKEN_DECIMALS) : null;
  } catch {
    parsed = null;
  }
  const insufficient = parsed !== null && balance !== undefined && parsed > balance;
  const canSubmit = !!address && !!sauce && !!source && !!parsed && parsed > 0n && !insufficient && !busy;

  const submit = async () => {
    if (!canSubmit || !parsed || !sauce || !source || !publicClient) return;
    try {
      if ((allowance ?? 0n) < parsed) {
        setBusy("Approving SAUCE…");
        const approveHash = await writeToken({
          address: sauce,
          abi: erc20Abi,
          functionName: "approve",
          args: [source.address, parsed],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        await refetchAllowance();
      }

      setBusy("Creating link and staking…");
      const keypair = newKeypair();
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + expiry);
      const txHash = await writeLinks({
        functionName: "createLink",
        args: [keypair.address, sauce, parsed, expiresAt, policy],
        gas: CREATE_GAS_LIMIT,
      });
      if (!txHash) return;
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");

      const url = buildClaimUrl(window.location.origin, keypair.privateKey, targetNetwork.id);
      saveStoredLink({ linkKey: keypair.address, url, createdAt: Date.now() });
      setCreated({ url, txHash });
    } catch (error) {
      notification.error(error instanceof Error ? error.message.slice(0, 200) : "Could not create the link");
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (created) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="badge badge-success badge-lg gap-1">
          <CheckIcon className="h-4 w-4" /> Staked and ready to send
        </div>
        <p className="text-base-content/70 max-w-md">
          Anyone who opens this link can claim the gift. It already earns yield. Share it like cash and only with the
          person you mean it for.
        </p>
        <div className="bg-white p-3 rounded-xl">
          <QRCodeSVG value={created.url} size={168} />
        </div>
        <div className="join w-full max-w-xl">
          <input readOnly value={created.url} className="input join-item w-full font-mono text-xs" />
          <button className="btn btn-primary join-item gap-1" onClick={copy}>
            {copied ? <CheckIcon className="h-4 w-4" /> : <ClipboardDocumentIcon className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="flex gap-4 text-sm">
          <a
            className="link"
            href={hashscanUrl(targetNetwork.id, `transaction/${created.txHash}`)}
            target="_blank"
            rel="noreferrer"
          >
            View on HashScan
          </a>
          <button className="link" onClick={() => setCreated(null)}>
            Create another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="flex justify-between text-sm font-medium">
          <span>Amount</span>
          <span className="text-base-content/60 font-normal">
            {balance !== undefined ? `Balance: ${formatToken(balance, 4)} SAUCE` : address ? "…" : ""}
          </span>
        </span>
        <div className="join w-full">
          <input
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className={`input join-item w-full text-lg ${insufficient ? "input-error" : ""}`}
            placeholder="0.0"
          />
          <span className="join-item flex items-center px-4 bg-base-200 text-sm font-medium">SAUCE</span>
        </div>
        {insufficient && <span className="text-error text-sm">Not enough SAUCE in this wallet.</span>}
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Link expires after</span>
        <div className="join">
          {EXPIRY_OPTIONS.map(option => (
            <button
              key={option.seconds}
              type="button"
              className={`btn join-item ${expiry === option.seconds ? "btn-primary" : "btn-outline"}`}
              onClick={() => setExpiry(option.seconds)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-base-content/60">
          Unclaimed links refund to you in full, including yield, and anyone can trigger the refund after expiry.
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Who keeps the yield?</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {YIELD_POLICIES.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPolicy(p.value)}
              className={`text-left rounded-xl border p-3 transition-colors ${
                policy === p.value ? "border-primary bg-primary/10" : "border-base-300 hover:border-primary/40"
              }`}
            >
              <div className="font-semibold text-sm">{p.label}</div>
              <div className="text-xs text-base-content/60">{p.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {address ? (
        <button className="btn btn-primary btn-lg" disabled={!canSubmit} onClick={submit}>
          {busy ? (
            <>
              <span className="loading loading-spinner" /> {busy}
            </>
          ) : (
            "Create gift link"
          )}
        </button>
      ) : (
        <div className="flex justify-center">
          <RainbowKitCustomConnectButton />
        </div>
      )}
    </div>
  );
};
