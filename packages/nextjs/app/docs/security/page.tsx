import { DocPageShell, Note, Section, Table } from "../_components";

export const metadata = { title: "Security" };

const threats: [string, string, string][] = [
  [
    "Mempool front-running a claim",
    "The signature covers (linkKey, recipient), so another recipient fails recovery",
    "test_claim_frontRunnerCannotRedirectFunds",
  ],
  ["Replaying a spent claim", "Status moves to Claimed and the shares are burned", "test_claim_cannotBeReplayed"],
  [
    "Replaying against a reused key",
    "Links are never deleted; a key is single use, forever",
    "test_createLink_keyCanNeverBeReused",
  ],
  [
    "Cross-chain or cross-contract replay",
    "The EIP-712 domain binds chain id and verifyingContract",
    "_hashTypedDataV4 in claim",
  ],
  ["Wrong signer", "ECDSA.recover must equal linkKey", "test_claim_revertsOnWrongSigner"],
  [
    "First-depositor inflation",
    "Virtual shares and assets (VIRTUAL = 1000)",
    "test_firstDepositorInflation_costsAttackerMoreThanVictimLoses",
  ],
  [
    "Insolvency from rounding",
    "Maths rounds against the user; payouts never exceed the pool",
    "testFuzz_poolStaysSolvent",
  ],
  ["Claim after expiry", "claim reverts after expiry; refund takes over", "test_claim_revertsAfterExpiry"],
  [
    "A stranger cancels early",
    "Only the sender can refund before expiry",
    "test_refund_strangerCannotCancelBeforeExpiry",
  ],
  [
    "Source drained by an outsider",
    "Source functions are onlyController, set once",
    "test_source_onlyControllerMovesFunds",
  ],
  [
    "Relayer drained with junk claims",
    "Simulate first, call only claim, cap gas, 10 requests a minute per IP",
    "app/api/claim/route.ts",
  ],
  [
    "Bulk account creation",
    "Requires an open link's signature over the new public key; one account per link",
    "ed25519.test.ts",
  ],
  ["Link that did not prepay", "Refused below 1.35 HBAR before anything is spent (HTTP 402)", "PrepaidFeeTest"],
  [
    "Fee payout reverts",
    "Low-level call; on failure the fee goes to pendingFees",
    "NoReceiveSender, NoReceiveSubmitter",
  ],
  [
    "Recipient short of the gift",
    "10-unit rounding reserve, value capped at totalAssets, bounded shortfall",
    "RecipientReceivesAtLeastTheAmountTest",
  ],
  ["Reentrancy", "nonReentrant on every entry point; state settled before payout", "YieldLinks.sol"],
];

export default function SecurityPage() {
  return (
    <DocPageShell
      slug="security"
      lead={
        <p>
          YieldLinks holds other people&apos;s tokens, so this page says what can go wrong, what stops it, and which
          test proves it. The long form is <code>docs/THREAT_MODEL.md</code> in the repository.
        </p>
      }
    >
      <Note tone="warn">
        <p>
          <strong>The contracts have not been audited.</strong> Testnet only until they are.
        </p>
      </Note>

      <Section id="bearer" n={1} title="A link is bearer value">
        <p>
          The private key in the URL fragment is the only thing that proves you may claim. Whoever has the link can
          claim it to any address. Everything else on this page limits what someone <em>without</em> the link can do.
        </p>
        <p>
          A leaked link cannot be made safe in this design. What limits the damage: short expiries, a sender who can
          cancel at any time, and a UI that tells people to share it like cash.
        </p>
      </Section>

      <Section id="trust" n={2} title="Who can do what">
        <Table
          head={["Party", "Can", "Cannot"]}
          rows={[
            ["Sender", "Create and cancel their own links", "Touch other links, or take back a claimed one"],
            [
              "Link holder",
              "Claim once, before expiry, to any address",
              "Claim twice, claim after expiry, touch other links",
            ],
            ["Relayer", "Pay gas for claim", "Move funds, call anything but claim, or change the recipient"],
            [
              "Deployer",
              "Bind the source once; withdraw its HBAR reserve",
              "Move escrowed tokens, change the controller, upgrade anything",
            ],
            ["Anyone", "Trigger a refund after expiry", "Send that refund anywhere but the sender"],
          ]}
        />
      </Section>

      <Section id="threats" n={3} title="Threats and what stops them">
        <Table
          head={["Threat", "What stops it", "Evidence"]}
          rows={threats.map(([threat, guard, evidence]) => [threat, guard, <code key={evidence}>{evidence}</code>])}
        />
      </Section>

      <Section id="gaps" n={4} title="Known gaps">
        <ul>
          <li>
            <strong>No audit.</strong> The fuzz and unit tests cover the contracts, not the relayer routes or the React
            code.
          </li>
          <li>
            <strong>The pool can lose value.</strong> The source is only as safe as SaucerSwap&apos;s Infinity Pool.
          </li>
          <li>
            <strong>SAUCE is volatile.</strong> A gift&apos;s dollar value moves with the market.
          </li>
          <li>
            <strong>Generated accounts cost the relayer.</strong> About 0.58 HBAR each, and the one-account-per-link
            record is in memory, reset on restart.
          </li>
          <li>
            <strong>The relayer is one process.</strong> Its rate limit is in memory and sends go through one nonce.
            Production needs a queue and shared limits.
          </li>
          <li>
            <strong>In-browser wallets are demo-grade.</strong> A recipient who loses the key loses the gift. Use
            passkeys or an embedded wallet in production.
          </li>
          <li>
            <strong>Links live in localStorage.</strong> The sender&apos;s browser keeps full URLs, secrets included, so
            they can re-share them.
          </li>
        </ul>
        <p>
          Found something? Open an issue for anything non-sensitive. For a vulnerability, contact the repository owner
          privately first.
        </p>
      </Section>
    </DocPageShell>
  );
}
