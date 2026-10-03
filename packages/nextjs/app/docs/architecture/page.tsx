import Link from "next/link";
import { Code, DocPageShell, Note, Section, Table } from "../_components";

export const metadata = { title: "Architecture" };

export default function ArchitecturePage() {
  return (
    <DocPageShell
      slug="architecture"
      lead={
        <p>
          Two contracts on chain, two routes on the server, and one rule that holds them together: the contract that
          keeps the books never holds the tokens.
        </p>
      }
    >
      <Section id="split" n={1} title="The split">
        <Table
          head={["", "Holds tokens", "Keeps the books", "Talks to SaucerSwap"]}
          rows={[
            [<code key="y">YieldLinks</code>, "No", "Yes", "No"],
            [<code key="s">SauceStakingSource</code>, "Yes", "No", "Yes"],
          ]}
        />
        <p>
          <code>YieldLinks</code> tracks links, shares, signatures and expiries. Every token sits in the source, which
          is bound once to one <code>YieldLinks</code> and obeys only it. Swap the source and the escrow logic never
          changes.
        </p>
        <Code lang="Diagram">{`  Sender ──createLink──▶ YieldLinks ──deposit──▶ SauceStakingSource ──enter──▶ SaucerSwap
                            │                       (holds xSAUCE)            Infinity Pool
  Relayer ───claim────────▶ │ ──withdraw──▶ source ──leave──▶ pool
                            │                  │
                            │                  └──HIP-904 airdrop (0x167)──▶ recipient
                            └── fee ──▶ relayer`}</Code>
      </Section>

      <Section id="contracts" n={2} title="The contracts">
        <Table
          head={["Contract", "Job"]}
          rows={[
            [<code key="a">YieldLinks</code>, "Escrow, pooled share accounting, EIP-712 claims, refunds, prepaid fees"],
            [<code key="b">IYieldSource</code>, "The seam: three functions every yield venue implements"],
            [<code key="c">ControlledSource</code>, "One-time controller binding, HBAR fee reserve, HIP-904 payout"],
            [
              <code key="d">SauceStakingSource</code>,
              "Stakes SAUCE in SaucerSwap's Infinity Pool, values xSAUCE at the pool ratio",
            ],
            [<code key="e">IdleSource</code>, "No yield. The reference implementation, used on plain Anvil."],
            [
              <code key="f">HtsLib</code>,
              "Token association and airdrops through 0x167, no-ops where HTS does not exist",
            ],
          ]}
        />
        <p>
          <code>script/Deploy.s.sol</code> picks the source by chain id: Hedera testnet, mainnet and a local fork (chain
          id 296) get <code>SauceStakingSource</code>, anything else gets <code>IdleSource</code>. It binds the source,
          then writes <code>packages/nextjs/contracts/deployedContracts.ts</code>, which is what the frontend reads.
        </p>
      </Section>

      <Section id="accounting" n={3} title="Pooled shares">
        <p>Each token has one pool of shares. Nothing is written per link when the pool earns.</p>
        <Code lang="Solidity">{`// minting, in createLink
shares = deposit * (totalShares + 1000) / (totalAssets + 1000)

// valuing, in claimable / claim / refund
value  = min(shares * (totalAssets + 1000) / (totalShares + 1000), totalAssets)`}</Code>
        <p>
          <code>totalAssets</code> is the SAUCE value of the source&apos;s xSAUCE plus any idle SAUCE, read live from
          the pool. When SaucerSwap&apos;s pool earns, every open link is worth more at once.
        </p>
        <Note>
          The <code>+ 1000</code> virtual offset stops a first depositor from inflating the share price against later
          users. It costs a permanent 0.001 SAUCE &quot;dead&quot; position whose sliver of yield stays in the source.
        </Note>
      </Section>

      <Section id="routes" n={4} title="The relayer routes">
        <Table
          head={["Route", "Does", "Refuses"]}
          rows={[
            [
              <code key="c">POST /api/claim</code>,
              "Simulates, then sends claim on the deployed YieldLinks, gas capped at 3M",
              "Unknown chains, links that prepaid under 1.35 HBAR, more than 10 requests a minute per IP",
            ],
            [
              <code key="a">POST /api/create-account</code>,
              "Creates an ED25519 account for a generated wallet with the Hiero SDK",
              "Callers who cannot prove they hold an open, unexpired link. One account per link.",
            ],
          ]}
        />
        <p>
          The claim route reads its nonce from the mirror node, because Hashio&apos;s can lag after a failed
          transaction. It can only call <code>claim</code>; its key has no authority over escrowed funds. Shared server
          code lives in <code>utils/relayer</code>.
        </p>
      </Section>

      <Section id="absent" n={5} title="What is deliberately absent">
        <Table
          head={["Not here", "Why"]}
          rows={[
            ["An owner", "Nobody can pause, drain or redirect escrow"],
            ["An upgrade proxy", "The rules a sender funded are the rules that pay out"],
            ["A keeper", "Refunds after expiry are permissionless, so nothing has to run on time"],
            [
              "The Schedule Service",
              "HIP-1215 scheduleCall has an open bug from delegatecall frames and a 62-day cap. Nothing depends on it.",
            ],
            ["A protocol fee", "The only fee is the network fee the sender prepays"],
          ]}
        />
        <p>
          The full reasoning behind each choice, and what an attacker can and cannot do, is on{" "}
          <Link href="/docs/security">Security</Link>.
        </p>
      </Section>
    </DocPageShell>
  );
}
