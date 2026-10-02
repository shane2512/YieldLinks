import { MIN_ACTIVATION_BALANCE_TINYBAR, planActivation } from "./activation";
import { describe, expect, it } from "vitest";

const hollow = (balanceTinybar: number) => ({ key: null, balanceTinybar });
const active = { key: { _type: "ECDSA_SECP256K1", key: "03ab" }, balanceTinybar: 98_000_000 };

describe("planActivation", () => {
  it("sends the drip to a funded-by-nobody hollow account created by a claim", () => {
    expect(planActivation({ account: hollow(0), paidByClaim: true })).toBe("needs-drip");
  });

  it("skips the drip once the account can pay for its own activating transaction", () => {
    expect(planActivation({ account: hollow(MIN_ACTIVATION_BALANCE_TINYBAR), paidByClaim: true })).toBe(
      "needs-signature",
    );
    expect(planActivation({ account: hollow(MIN_ACTIVATION_BALANCE_TINYBAR - 1), paidByClaim: true })).toBe(
      "needs-drip",
    );
  });

  it("reports an account whose key is recorded as already active", () => {
    expect(planActivation({ account: active, paidByClaim: true })).toBe("already-active");
  });

  it("never funds an address that no claim paid, so the relayer cannot be used as a faucet", () => {
    expect(planActivation({ account: hollow(0), paidByClaim: false })).toBe("not-eligible");
    expect(planActivation({ account: active, paidByClaim: false })).toBe("not-eligible");
  });

  it("does nothing while the account is not visible yet", () => {
    expect(planActivation({ account: null, paidByClaim: true })).toBe("not-eligible");
  });

  it("cannot be asked for HBAR twice: once funded, the plan no longer asks for a drip", () => {
    const afterDrip = hollow(10_000_000);
    expect(planActivation({ account: afterDrip, paidByClaim: true })).not.toBe("needs-drip");
  });
});
