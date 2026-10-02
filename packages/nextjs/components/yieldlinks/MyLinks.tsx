"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { useDeployedContractInfo, useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { notification } from "~~/utils/scaffold-hbar";
import { LINK_STATUS, StoredLink, describeWalletError, formatToken, loadStoredLinks } from "~~/utils/yieldlinks";

const REFUND_GAS_LIMIT = 2_000_000n;

const statusBadge: Record<string, string> = {
  Open: "badge-info",
  Claimed: "badge-success",
  Refunded: "badge-neutral",
};

/** Links this browser created. The secret lives in the stored URL, so only this device can re-share them. */
export const MyLinks = () => {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const { data: contract } = useDeployedContractInfo({ contractName: "YieldLinks" });
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "YieldLinks" });

  const [stored, setStored] = useState<StoredLink[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setStored(loadStoredLinks()), []);

  const { data, refetch } = useReadContracts({
    contracts: contract
      ? stored.flatMap(l => [
          {
            address: contract.address,
            abi: contract.abi,
            chainId: targetNetwork.id,
            functionName: "links",
            args: [l.linkKey],
          },
          {
            address: contract.address,
            abi: contract.abi,
            chainId: targetNetwork.id,
            functionName: "claimable",
            args: [l.linkKey],
          },
        ])
      : [],
    query: { enabled: !!contract && stored.length > 0, refetchInterval: 15_000 },
  });

  const copy = async (link: StoredLink) => {
    await navigator.clipboard.writeText(link.url);
    setCopied(link.linkKey);
    setTimeout(() => setCopied(null), 2000);
  };

  const refund = async (linkKey: string) => {
    setBusy(linkKey);
    try {
      await writeContractAsync({ functionName: "refund", args: [linkKey as `0x${string}`], gas: REFUND_GAS_LIMIT });
      // Hashio can serve state a few seconds behind the chain, so refresh now and once more shortly after.
      await refetch();
      setTimeout(() => void refetch(), 5000);
    } catch (error) {
      notification.error(describeWalletError(error));
    } finally {
      setBusy(null);
    }
  };

  if (stored.length === 0) {
    return (
      <div className="text-center text-base-content/70 py-8">
        No links created in this browser yet.{" "}
        <Link href="/" className="link link-primary">
          Send your first gift
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {stored.map((link, i) => {
        const linkData = data?.[i * 2]?.result as
          | readonly [string, bigint, number, number, string, bigint, bigint, bigint, bigint]
          | undefined;
        const claimable = data?.[i * 2 + 1]?.result as readonly [bigint, bigint] | undefined;
        const status = linkData ? LINK_STATUS[linkData[2]] : undefined;
        const isSender = !!address && !!linkData && linkData[0].toLowerCase() === address.toLowerCase();
        const expired = !!linkData && Date.now() / 1000 >= Number(linkData[1]);

        return (
          <div key={link.linkKey} className="rounded-xl border border-base-300 p-4 flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-48">
              <div className="flex items-center gap-2">
                {status ? (
                  <span className={`badge ${statusBadge[status] ?? ""}`}>{status}</span>
                ) : (
                  <span className="loading loading-dots loading-xs" />
                )}
                <span className="text-xs text-base-content/50">{new Date(link.createdAt).toLocaleString()}</span>
              </div>
              {claimable && status === "Open" && (
                <div className="mt-2 font-mono text-lg tabular-nums">
                  {formatToken(claimable[0], 6)} <span className="text-sm text-base-content/60">SAUCE</span>
                  <span className="ml-2 text-xs text-base-content/50">from {formatToken(claimable[1], 4)}</span>
                </div>
              )}
              {linkData && status === "Open" && linkData[8] > 0n && (
                <div className="mt-1 text-xs text-base-content/50">
                  Network fee prepaid: {formatUnits(linkData[8], 8)} HBAR, returned to you if you cancel
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-sm btn-outline gap-1" onClick={() => copy(link)}>
                {copied === link.linkKey ? (
                  <CheckIcon className="h-4 w-4" />
                ) : (
                  <ClipboardDocumentIcon className="h-4 w-4" />
                )}
                Copy link
              </button>
              {status === "Open" && (isSender || expired) && (
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={busy === link.linkKey}
                  onClick={() => refund(link.linkKey)}
                >
                  {busy === link.linkKey ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : expired ? (
                    "Refund"
                  ) : (
                    "Cancel"
                  )}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
