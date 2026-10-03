import { Code, DocPageShell, Note, Section, Table } from "../_components";

export const metadata = { title: "Fees and guarantees" };

export default function FeesPage() {
  return (
    <DocPageShell
      slug="fees"
      lead={
        <p>
          A gift that arrives smaller than it was sent is a broken promise. This page is the arithmetic behind the one
          guarantee YieldLinks makes, and every figure in it was measured on Hedera testnet.
        </p>
      }
    >
      <Section id="rule" n={1} title="The rule">
        <Note>
          <p>
            <strong>The sender pays every cost; the recipient gets at least the gift.</strong> Send 5 SAUCE and the
            recipient receives at least 5 SAUCE, plus yield if the policy gives it to them.
          </p>
        </Note>
        <p>Two mechanisms make that true, and the tests hold them to it:</p>
        <Table
          head={["Cost", "Paid by", "How"]}
          rows={[
            ["Rounding in share and pool maths", "Sender", "A 10-unit rounding reserve on top of the gift"],
            ["Submitting the claim", "Sender", "The prepaid network fee, sent with createLink"],
            ["Creating the recipient's account", "Sender", "The same prepaid fee"],
          ]}
        />
        <p>
          <code>test/Guarantees.t.sol</code> fuzzes it: <code>RecipientReceivesAtLeastTheAmountTest</code> tries random
          amounts and checks the recipient never ends up below the gift.
        </p>
      </Section>

      <Section id="dust" n={2} title="The rounding reserve">
        <p>
          Shares round down when minted and the Infinity Pool rounds on <code>enter</code> and <code>leave</code>, so a
          link can come out a unit or two short of what went in. <code>createLink</code> therefore takes{" "}
          <code>amount + ROUNDING_DUST</code>, where <code>ROUNDING_DUST = 10</code>:
        </p>
        <Code lang="Output">{`gift      5.000000 SAUCE
reserve   0.000010 SAUCE   (10 base units, 6 decimals)
approved  5.000010 SAUCE`}</Code>
        <p>
          Two other guards back it up. A link&apos;s value is capped at what the pool actually holds, so a claim never
          asks for more than exists, and the source tolerates a shortfall of at most 2 units when one link pays twice
          (recipient, then yield). Fuzzing found both cases before testnet did.
        </p>
      </Section>

      <Section id="prepaid" n={3} title="The prepaid network fee">
        <p>
          The sender attaches <strong>1.5 HBAR</strong> to <code>createLink</code>. The contract stores it with the link
          and hands it over when the link closes:
        </p>
        <Table
          head={["Outcome", "The fee goes to"]}
          rows={[
            ["Claimed", "Whoever submitted the claim, normally the relayer"],
            ["Cancelled or expired", "Back to the sender, with the tokens"],
          ]}
        />
        <p>
          The relayer refuses any link that prepaid less than <code>MIN_PREPAID_FEE_TINYBAR</code> = 1.35 HBAR, before
          it spends anything, with HTTP 402 <code>FeeNotPrepaid</code>. So a link that cannot reimburse it never costs
          it HBAR.
        </p>
      </Section>

      <Section id="measured" n={4} title="What a claim costs">
        <p>Measured on testnet on 3 October 2026, at about $0.105 per HBAR:</p>
        <Table
          head={["Step", "HBAR", "Paid from"]}
          rows={[
            [
              "Create the recipient's account (generated wallet)",
              "0.58",
              "Relayer, includes the 0.1 HBAR welcome balance",
            ],
            ["Submit the claim", "0.74", "Relayer"],
            [<strong key="t">Total</strong>, <strong key="t2">1.32</strong>, "Reimbursed from the 1.5 HBAR prepaid"],
          ]}
        />
        <p>
          A claim to an existing wallet or a pasted address skips the account step and costs only the claim. The sender
          also pays for their own approve and <code>createLink</code> transactions, from their wallet, like any
          transaction.
        </p>
        <Note tone="warn">
          Who pays the HIP-904 account-creation fee has changed between network versions: on 1 October the sending
          contract paid it, on 2 October the transaction payer did. The source keeps a small HBAR reserve as a margin.
          Re-check on the network you deploy to.
        </Note>
      </Section>

      <Section id="units" n={5} title="Tinybar and weibar">
        <p>The same HBAR has two units depending on where you read it:</p>
        <Table
          head={["Where", "Unit", "Decimals", "1.5 HBAR is"]}
          rows={[
            ["Inside the EVM: msg.value, the stored fee", "tinybar", "8", "150_000_000"],
            ["Over JSON-RPC: ethers, viem, wallets", "weibar", "18", "1_500_000_000_000_000_000"],
          ]}
        />
        <Code lang="TypeScript">{`// Sending: weibar goes in, the relay divides by 1e10.
await writeLinks({ functionName: "createLink", args, value: parseEther("1.5") });

// Reading it back from the contract: tinybar comes out.
const link = await links.read.links([linkKey]);
const feeHbar = Number(link[8]) / 1e8; // 1.5`}</Code>
      </Section>

      <Section id="stuck" n={6} title="When a fee cannot be paid">
        <p>
          The fee is sent with a low-level call. If the recipient of the fee cannot accept HBAR (a contract with no{" "}
          <code>receive</code>), the claim or refund still goes through and the fee is credited to the link&apos;s
          sender in <code>pendingFees</code>.
        </p>
        <Code lang="Solidity">{`links.withdrawPendingFees(payable(to)); // any address the sender chooses`}</Code>
        <p>Nothing gets stuck, and a hostile submitter cannot block a claim by refusing its own fee.</p>
      </Section>
    </DocPageShell>
  );
}
