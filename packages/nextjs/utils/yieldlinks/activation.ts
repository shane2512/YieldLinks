/**
 * A wallet generated on the claim page is a *hollow* Hedera account: it exists by EVM address, but its public key is
 * not recorded until it signs its first transaction. Wallet apps such as HashPack find accounts by public key, so until
 * then they report "no account found" when the private key is imported.
 *
 * Activation makes the account importable: the relayer sends a little HBAR, then the browser signs one tiny
 * transaction with the generated key. These rules decide who may receive that HBAR, so the relayer cannot be used as a
 * faucet.
 */

/** HBAR the relayer sends, enough for the activating transaction (about 0.017 HBAR) and a little more. */
export const ACTIVATION_DRIP_HBAR = "0.1";

/** Below this balance (0.05 HBAR, in tinybar) an account cannot pay for its own activating transaction. */
export const MIN_ACTIVATION_BALANCE_TINYBAR = 5_000_000;

export type ActivationAccount = {
  /** The account's public key as reported by the mirror node. `null` while the account is hollow. */
  key: unknown | null;
  balanceTinybar: number;
};

export type ActivationPlan =
  /** Not a recipient of one of our claims, or the account is not visible yet. Never send HBAR. */
  | "not-eligible"
  /** The key is already recorded; wallets can find this account. */
  | "already-active"
  /** Hollow and funded: only the account's own signature is missing. */
  | "needs-signature"
  /** Hollow and unfunded: send the drip first. */
  | "needs-drip";

export const planActivation = ({
  account,
  paidByClaim,
}: {
  account: ActivationAccount | null;
  paidByClaim: boolean;
}): ActivationPlan => {
  if (!account || !paidByClaim) return "not-eligible";
  if (account.key) return "already-active";
  return account.balanceTinybar >= MIN_ACTIVATION_BALANCE_TINYBAR ? "needs-signature" : "needs-drip";
};
