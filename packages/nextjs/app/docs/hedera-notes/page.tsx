import { Code, DocPageShell, Note, Section, Table } from "../_components";

export const metadata = { title: "Hedera notes" };

export default function HederaNotesPage() {
  return (
    <DocPageShell
      slug="hedera-notes"
      lead={
        <p>
          Platform behaviour found while building this template, each one verified on Hedera testnet between 1 and 3
          October 2026. Read this before you change the contracts or the relayer: most of these cost an hour the first
          time.
        </p>
      }
    >
      <Section id="tooling" n={1} title="Transactions and tooling">
        <Table
          head={["What goes wrong", "What you see", "Fix"]}
          rows={[
            [
              "Hashio's nonce lags after a failed transaction",
              <code key="a">WRONG_NONCE</code>,
              "Read ethereum_nonce from the mirror node (GET /api/v1/accounts/{address}) and pass it explicitly",
            ],
            [
              "An EIP-1559 gas guess falls below Hedera's minimum",
              <code key="b">Gas price … is below configured minimum</code>,
              "Send legacy transactions (type 0) at the node's gas price. Foundry needs --legacy.",
            ],
            [
              "Simulating from an unfunded account",
              <code key="c">INSUFFICIENT_PAYER_BALANCE</code>,
              "Fund the account you simulate from, even for an eth_call",
            ],
            [
              "A revert deep in a contract",
              "No trace from Hashio",
              "GET /api/v1/contracts/results/{txHash}/actions on the mirror node",
            ],
            ["Reads right after a write", "Old values for a few seconds", "Wait and refetch"],
            [
              "A two-contract forge script",
              "Out of gas in simulation",
              "--gas-limit 14000000 (yarn foundry:deploy already passes it)",
            ],
          ]}
        />
      </Section>

      <Section id="hts" n={2} title="HTS and HIP-904">
        <p>
          <strong>HIP-904 airdrops work from a contract.</strong> <code>airdropTokens</code> on the HTS system contract
          (<code>0x167</code>), called by the source, delivered to an EVM address Hedera had never seen. The mirror node
          then showed a new account with <code>max_automatic_token_associations: -1</code>, the balance credited, and no
          pending airdrop.
        </p>
        <Code lang="ABI">{`airdropTokens((address,(address,int64,bool)[],(address,address,int64,bool)[])[])`}</Code>
        <ul>
          <li>
            <strong>Association is a precompile call.</strong> <code>associateToken(account, token)</code> at{" "}
            <code>0x167</code> returns <code>22</code> on success and <code>194</code> if already associated.{" "}
            <code>HtsLib.associate</code> accepts both.
          </li>
          <li>
            <strong>The ERC-20 facade just works</strong> for <code>approve</code>, <code>transferFrom</code> and{" "}
            <code>balanceOf</code> on HTS tokens, from contracts too.
          </li>
          <li>
            <strong>
              <code>msg.value</code> is tinybar.
            </strong>{" "}
            Sending 1.5 HBAR arrives as <code>150_000_000</code>, though wallets show 18 decimals.
          </li>
          <li>
            <strong>Fuzzing found two rounding bugs</strong>: a tiny deposit valued above the pool (now capped at{" "}
            <code>totalAssets</code>), and a second payout one unit short after <code>leave</code> (now a bounded
            shortfall).
          </li>
        </ul>
        <Note tone="warn">
          Who pays the account-creation fee changed between network versions. On 1 October a <code>TOKENAIRDROP</code>{" "}
          child record charged the sending contract 0.482 HBAR. On 2 October the account was created inside the claim
          and the relayer paid one 1.281 HBAR fee. Keep a small HBAR reserve on the source and re-check.
        </Note>
      </Section>

      <Section id="accounts" n={3} title="Accounts and wallet apps">
        <p>
          <strong>Hollow accounts have no key on record.</strong> An address that has only received something exists and
          holds balances, but the mirror node shows <code>key: null</code> until it signs a transaction, so a wallet
          cannot find it by key.
        </p>
        <p>
          <strong>HashPack imports ED25519 by default.</strong> Its import field takes 64 or 96 characters, and 96 is an
          ED25519 DER key. Generated ECDSA keys were not found even after activation. So generated wallets are ED25519
          accounts, created up front with the Hiero SDK, and the claim pays them at their long-zero address (
          <code>0x</code> plus the account number in 40 hex characters).
        </p>
        <p>
          <strong>A brand-new account is briefly invisible.</strong> Claiming seconds after creating it reverted with{" "}
          <code>INVALID_ALIAS_KEY</code>. <code>/api/create-account</code> waits until the RPC sees the account, and{" "}
          <code>/api/claim</code> retries that one error.
        </p>
      </Section>

      <Section id="saucerswap" n={4} title="SaucerSwap addresses">
        <Table
          head={["Thing", "Testnet", "Mainnet"]}
          rows={[
            ["Infinity Pool (Mothership)", <code key="a">0.0.1418650</code>, <code key="a2">0.0.1460199</code>],
            ["SAUCE", <code key="b">0.0.1183558</code>, <code key="b2">0.0.731861</code>],
            ["xSAUCE", <code key="c">0.0.1418651</code>, <code key="c2">0.0.1460200</code>],
            ["V1 router", <code key="d">0.0.19264</code>, "—"],
            ["WHBAR token (use in swap paths)", <code key="e">0.0.15058</code>, "—"],
          ]}
        />
        <p>
          A round trip loses 1 base unit to rounding. On 2 October one xSAUCE was worth 1.003 SAUCE on testnet, so a
          demo link&apos;s growth is real but tiny.
        </p>
      </Section>

      <Section id="dead-ends" n={5} title="Dead ends">
        <h3>Bonzo Finance</h3>
        <p>
          The first-choice venue, because lending is a named integration. On testnet every <code>deposit</code> reverts
          with <code>CALLER_NOT_AUTHORIZED</code>: the mirror-node trace shows the aToken&apos;s <code>mint</code>{" "}
          calling the rewards controller&apos;s <code>handleAction</code> on <code>0.0.4998053</code>, which reverts.
          Reproduced on two reserves. On mainnet <code>paused()</code> returns <code>true</code> and USDC earns about
          0.009%.
        </p>
        <h3>Hedera Schedule Service</h3>
        <p>
          Scheduled refunds were the obvious design. HIP-1215 <code>scheduleCall</code> has an open bug when booked from
          a delegatecall frame (
          <a href="https://github.com/hiero-ledger/hiero-consensus-node/issues/27263">hiero-consensus-node #27263</a>),
          a 62-day expiry cap, and unproven self-rescheduling. Refunds are permissionless instead, so nothing depends on
          it.
        </p>
        <h3>ECDSA generated wallets</h3>
        <p>
          The first generated wallets were ECDSA. HashPack could not import them, activated or not. They are ED25519
          now.
        </p>
      </Section>
    </DocPageShell>
  );
}
