"use client";

import { useEffect, useState } from "react";
import { ROUNDING_DUST, TOKEN_DECIMALS } from "~~/utils/yieldlinks";

type GrowingAmountProps = {
  /** Current value of the link in token base units, read on-chain at `fetchedAt`. */
  assets: bigint;
  principal: bigint;
  /** Link creation time, unix seconds. */
  createdAt: number;
  /** When `assets` was read, unix milliseconds. */
  fetchedAt: number;
  symbol?: string;
};

// Never extrapolate further than this past the last on-chain read; the real value is re-read every few seconds.
const MAX_EXTRAPOLATION_SECONDS = 60;

/**
 * Ticks between on-chain reads using the growth rate observed since the link was created, so the number moves
 * smoothly instead of jumping. It is an estimate; the contract's own `claimable` is the source of truth.
 */
export const GrowingAmount = ({ assets, principal, createdAt, fetchedAt, symbol = "SAUCE" }: GrowingAmountProps) => {
  const [now, setNow] = useState(fetchedAt);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const unit = 10 ** TOKEN_DECIMALS;
  // The sender adds a tiny rounding reserve on top of the gift. It is part of the value but it is not yield, so it must
  // not show up as earnings or feed the per-day estimate.
  const gained = assets > principal + ROUNDING_DUST ? Number(assets - principal - ROUNDING_DUST) : 0;
  const ageSeconds = Math.max(1, fetchedAt / 1000 - createdAt);
  const perSecond = gained / ageSeconds;
  const sinceRead = Math.min(MAX_EXTRAPOLATION_SECONDS, Math.max(0, (now - fetchedAt) / 1000));
  const value = (Number(assets) + perSecond * sinceRead) / unit;

  const [whole, frac] = value.toFixed(8).split(".");
  const perDay = (perSecond * 86_400) / unit;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="font-mono text-4xl sm:text-5xl font-semibold tabular-nums tracking-tight">
        {Number(whole).toLocaleString()}.<span>{frac.slice(0, 4)}</span>
        <span className="text-base-content/40">{frac.slice(4)}</span>
        <span className="ml-2 text-lg font-sans font-medium text-base-content/60">{symbol}</span>
      </div>
      <div className="text-sm text-base-content/60">
        {gained > 0 ? (
          <>
            <span className="text-success font-medium">+{(gained / unit).toFixed(6)}</span> earned so far · about{" "}
            {perDay.toFixed(6)} per day
          </>
        ) : (
          "Earning as the SaucerSwap pool collects fees"
        )}
      </div>
    </div>
  );
};
