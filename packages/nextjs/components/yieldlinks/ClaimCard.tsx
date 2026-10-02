"use client";

import { useEffect, useMemo, useState } from "react";
import { Address, Hex, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ArrowDownTrayIcon, CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { GrowingAmount } from "~~/components/yieldlinks/GrowingAmount";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { LINK_STATUS, formatToken, hashscanUrl, newKeypair, parseClaimHash, signClaim } from "~~/utils/yieldlinks";

type Wallet = { address: Address; privateKey: Hex };
type Claimed = { hash: string; recipient: Address };

const REFRESH_MS = 15_000;

const formatTimeLeft = (seconds: number) => {
  if (seconds <= 0) return "expired";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

export const ClaimCard = () => {
  const { targetNetwork } = useTargetNetwork();
  const [secret, setSecret] = useState<Hex | null | undefined>(undefined);
  const [wrongNetwork, setWrongNetwork] = useState(false);

  const [mode, setMode] = useState<"new" | "paste">("new");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [saved, setSaved] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<Claimed | null>(null);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const parsed = parseClaimHash(window.location.hash);
    setSecret(parsed?.privateKey ?? null);
    setWrongNetwork(!!parsed?.chainId && parsed.chainId !== targetNetwork.id);
  }, [targetNetwork.id]);

  useEffect(() => {
    const id = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const linkKey = useMemo(() => (secret ? privateKeyToAccount(secret).address : undefined), [secret]);
  const { data: contract } = useDeployedContractInfo({ contractName: "YieldLinks" });

  const { data: link } = useScaffoldReadContract({
    contractName: "YieldLinks",
    functionName: "links",
    args: [linkKey],
    query: { enabled: !!linkKey, refetchInterval: REFRESH_MS },
  });
  const { data: claimable, dataUpdatedAt } = useScaffoldReadContract({
    contractName: "YieldLinks",
    functionName: "claimable",
    args: [linkKey],
    query: { enabled: !!linkKey, refetchInterval: REFRESH_MS },
  });

  const recipient: Address | null = mode === "new" ? (wallet?.address ?? null) : isAddress(pasted) ? pasted : null;
  const status = link ? LINK_STATUS[link[2]] : undefined;
  const expiry = link ? Number(link[1]) : 0;
  const createdAt = link ? Number(link[5]) : 0;
  const expired = !!link && nowSeconds >= expiry;
  const canClaim = status === "Open" && !expired && !!recipient && (mode === "paste" || saved) && !busy && !!contract;

  const createWallet = () => {
    setWallet(newKeypair());
    setSaved(false);
  };

  const downloadKey = () => {
    if (!wallet) return;
    const text = `Hedera wallet created by YieldLinks\nAddress: ${wallet.address}\nPrivate key: ${wallet.privateKey}\n\nAnyone with this key controls the funds. Store it somewhere safe.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "hedera-wallet-key.txt";
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  const claim = async () => {
    if (!canClaim || !secret || !contract || !recipient) return;
    setBusy(true);
    setError(null);
    try {
      const signature = await signClaim(secret, contract.address, targetNetwork.id, recipient);
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: targetNetwork.id, linkKey, recipient, signature }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Claim failed");
      setClaimed({ hash: body.hash, recipient });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setBusy(false);
    }
  };

  if (secret === undefined) return <span className="loading loading-dots loading-lg self-center" />;

  if (secret === null) {
    return (
      <div className="text-center text-base-content/70">
        This page needs a gift link. Ask the sender to share it again; it should end in <code>#k=…</code>.
      </div>
    );
  }

  if (wrongNetwork) {
    return (
      <div className="alert alert-warning">
        This link was created on a different Hedera network than the one this app is pointed at ({targetNetwork.name}).
      </div>
    );
  }

  if (!link || claimable === undefined) return <span className="loading loading-dots loading-lg self-center" />;

  if (claimed) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="badge badge-success badge-lg gap-1">
          <CheckIcon className="h-4 w-4" /> Claimed
        </div>
        <p className="text-lg font-medium">The gift is in your Hedera account.</p>
        <p className="text-sm text-base-content/70 max-w-md break-all">
          Delivered to <span className="font-mono">{claimed.recipient}</span>. If that address had no account yet, the
          claim created one and associated the token for you.
        </p>
        <div className="flex gap-4 text-sm">
          <a
            className="link"
            href={hashscanUrl(targetNetwork.id, `transaction/${claimed.hash}`)}
            target="_blank"
            rel="noreferrer"
          >
            View transaction
          </a>
          <a
            className="link"
            href={hashscanUrl(targetNetwork.id, `account/${claimed.recipient}`)}
            target="_blank"
            rel="noreferrer"
          >
            View account
          </a>
        </div>
      </div>
    );
  }

  if (status !== "Open") {
    return (
      <div className="text-center">
        <div className="badge badge-neutral badge-lg mb-2">{status}</div>
        <p className="text-base-content/70">
          {status === "Claimed" ? "This gift has already been claimed." : "The sender took this gift back."}
        </p>
      </div>
    );
  }

  const [assets, principal] = claimable;

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="text-sm uppercase tracking-widest text-base-content/50 mb-3">You received a gift</div>
        <GrowingAmount assets={assets} principal={principal} createdAt={createdAt} fetchedAt={dataUpdatedAt} />
        <div className="mt-3 text-sm text-base-content/60">
          Started at {formatToken(principal, 4)} SAUCE ·{" "}
          <span className={expired ? "text-error" : ""}>{formatTimeLeft(expiry - nowSeconds)}</span>
        </div>
      </div>

      {expired ? (
        <div className="alert alert-warning">This link has expired. The sender can take the gift back.</div>
      ) : (
        <>
          <div role="tablist" className="tabs tabs-box self-center">
            <button role="tab" className={`tab ${mode === "new" ? "tab-active" : ""}`} onClick={() => setMode("new")}>
              Create a wallet for me
            </button>
            <button
              role="tab"
              className={`tab ${mode === "paste" ? "tab-active" : ""}`}
              onClick={() => setMode("paste")}
            >
              I have an address
            </button>
          </div>

          {mode === "new" ? (
            <div className="flex flex-col gap-3">
              {!wallet ? (
                <button className="btn btn-outline self-center" onClick={createWallet}>
                  Generate wallet
                </button>
              ) : (
                <div className="rounded-xl border border-base-300 p-4 flex flex-col gap-3">
                  <div className="text-xs text-base-content/60">Your new address</div>
                  <div className="font-mono text-xs break-all">{wallet.address}</div>
                  <div className="text-xs text-base-content/60">Private key. This is the only copy, save it.</div>
                  <div className="join">
                    <input readOnly value={wallet.privateKey} className="input join-item w-full font-mono text-xs" />
                    <button
                      className="btn join-item"
                      onClick={() => {
                        void navigator.clipboard.writeText(wallet.privateKey);
                      }}
                      aria-label="Copy private key"
                    >
                      <ClipboardDocumentIcon className="h-4 w-4" />
                    </button>
                    <button className="btn join-item" onClick={downloadKey} aria-label="Download private key">
                      <ArrowDownTrayIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <label className="label cursor-pointer justify-start gap-3">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-primary"
                      checked={saved}
                      onChange={e => setSaved(e.target.checked)}
                    />
                    <span className="text-sm">I saved my private key somewhere safe</span>
                  </label>
                </div>
              )}
            </div>
          ) : (
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Your Hedera EVM address</span>
              <input
                value={pasted}
                onChange={e => setPasted(e.target.value.trim())}
                className={`input w-full font-mono text-sm ${pasted && !recipient ? "input-error" : ""}`}
                placeholder="0x…"
              />
              <span className="text-xs text-base-content/60">
                It does not need to exist on Hedera yet or be associated with the token.
              </span>
            </label>
          )}

          {error && <div className="alert alert-error text-sm">{error}</div>}

          <button className="btn btn-primary btn-lg" disabled={!canClaim} onClick={claim}>
            {busy ? (
              <>
                <span className="loading loading-spinner" /> Claiming…
              </>
            ) : (
              "Claim gift"
            )}
          </button>
          <p className="text-xs text-center text-base-content/50">
            {busy
              ? "Hedera is confirming your claim. This usually takes 10 to 20 seconds."
              : "No wallet or HBAR needed. A relayer pays the network fee."}
          </p>
        </>
      )}
    </div>
  );
};
