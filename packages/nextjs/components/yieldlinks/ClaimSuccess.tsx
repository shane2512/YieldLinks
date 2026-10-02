"use client";

import { useState } from "react";
import { Address } from "viem";
import { CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { hashscanUrl } from "~~/utils/yieldlinks";

type ClaimSuccessProps = {
  hash: string;
  recipient: Address;
  /** Set only when the claim page created this account, so we hold its key and can show how to import it. */
  generated?: { accountId: string; privateKey: string; privateKeyDer: string };
};

export const ClaimSuccess = ({ hash, recipient, generated }: ClaimSuccessProps) => {
  const { targetNetwork } = useTargetNetwork();
  const [copied, setCopied] = useState<string | null>(null);
  const networkName = targetNetwork.id === 295 ? "Mainnet" : "Testnet";

  const copy = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="badge badge-success badge-lg gap-1">
        <CheckIcon className="h-4 w-4" /> Claimed
      </div>
      <p className="text-lg font-medium">The gift is in your Hedera account.</p>
      <p className="text-sm text-base-content/70 max-w-md break-all">
        {generated ? (
          <>
            Your new account is <span className="font-mono">{generated.accountId}</span>.
          </>
        ) : (
          <>
            Delivered to <span className="font-mono">{recipient}</span>. If that address had no account yet, the claim
            created one and associated the token for you.
          </>
        )}
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
          href={hashscanUrl(targetNetwork.id, `account/${generated?.accountId ?? recipient}`)}
          target="_blank"
          rel="noreferrer"
        >
          View account
        </a>
      </div>

      {generated && (
        <div className="w-full rounded-xl border border-base-300 p-4 text-left flex flex-col gap-3">
          <div className="font-semibold text-sm">Use this account in a wallet app</div>
          <p className="text-sm text-base-content/70">
            It is a standard ED25519 Hedera account with its key on record, so wallet apps can find it.
          </p>
          <div className="flex flex-col gap-2">
            <CopyRow id="account" label="Account ID" value={generated.accountId} copied={copied} onCopy={copy} />
            <CopyRow
              id="der"
              label="Private key, DER format, 96 characters (HashPack)"
              value={generated.privateKeyDer}
              copied={copied}
              onCopy={copy}
            />
            <CopyRow
              id="key"
              label="Private key, 64 characters (also accepted)"
              value={generated.privateKey}
              copied={copied}
              onCopy={copy}
            />
          </div>
          <ol className="list-decimal pl-5 text-sm space-y-1 text-base-content/80">
            <li>
              In HashPack, choose Add account, then Import, and select the <strong>{networkName}</strong> network.
            </li>
            <li>
              Enter the account ID if it asks, and paste the 96-character DER key. The 64-character form also fits
              HashPack&apos;s field.
            </li>
            <li>HashPack should list this account, holding your gift.</li>
          </ol>
          <p className="text-xs text-base-content/50">
            This is an ED25519 account: it works in HashPack, Blade and Hedera tools, but not in MetaMask. Keep your
            private key private: anyone who has it controls the account.
          </p>
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
