import Link from "next/link";
import { Code, DocPageShell, Note, Section, Table } from "./_components";

const tx = (hash: string) => `https://hashscan.io/testnet/transaction/${hash}`;

export default function QuickstartPage() {
  return (
    <DocPageShell
      slug=""
      lead={
        <>
          <p>
            <strong>Gift links that grow.</strong> A Scaffold-HBAR template for sending tokens to someone who has no
            wallet, no HBAR and no Hedera account. The tokens earn yield in SaucerSwap until they are claimed, and the
            recipient taps once to receive them.
          </p>
          <div className="docs-cards">
            <div className="docs-card">
              <strong>Earns while it waits</strong>
              <span>Escrowed SAUCE is staked in SaucerSwap&apos;s Infinity Pool as xSAUCE</span>
            </div>
            <div className="docs-card">
              <strong>Creates the account</strong>
              <span>A HIP-904 airdrop makes the recipient&apos;s account and associates the token</span>
            </div>
            <div className="docs-card">
              <strong>Costs the recipient nothing</strong>
              <span>A relayer submits the claim, paid from a fee the sender prepaid</span>
            </div>
            <div className="docs-card">
              <strong>Cannot be redirected</strong>
              <span>An EIP-712 signature binds every claim to its recipient, chain and contract</span>
            </div>
          </div>
          <p>
            About five minutes from nothing to a gift claimed into a brand-new account. Everything below was run end to
            end on Hedera testnet before it was written down.
          </p>
        </>
      }
    >
      <Section id="scaffold" n={1} title="Scaffold it">
        <Code>{`npm create scaffold-hbar@latest -- --template shane2512/YieldLinks`}</Code>
        <Note>
          The <code>--</code> is not optional. Without it npm consumes <code>--template</code> and you land in the stock
          template picker.
        </Note>
        <p>You get one repository with two Yarn workspaces:</p>
        <Table
          head={["Workspace", "What is in it"]}
          rows={[
            [
              <code key="f">packages/foundry</code>,
              "YieldLinks, the yield sources, 54 tests (unit, fuzz, stateful invariants), deploy and demo scripts",
            ],
            [
              <code key="n">packages/nextjs</code>,
              "The send page, the wallet-free claim page, your links, the relayer routes and these docs",
            ],
          ]}
        />
        <p>
          Prerequisites: Node.js 20.18.3 or later, Yarn, and <a href="https://book.getfoundry.sh">Foundry</a> (
          <code>forge</code>, <code>cast</code>). Fund a testnet account from the{" "}
          <a href="https://portal.hedera.com/faucet">Hedera Portal faucet</a>.
        </p>
        <Code>{`cd <your-project>
yarn install`}</Code>
      </Section>

      <Section id="relayer" n={2} title="Configure the relayer">
        <p>
          The relayer is a Next.js route that submits claims so recipients need no HBAR. It needs a key, and that key
          stays on the server.
        </p>
        <Code>{`cp packages/nextjs/.env.example packages/nextjs/.env.local`}</Code>
        <Code lang="packages/nextjs/.env.local">{`# Server-only. A dedicated, lightly funded testnet account that pays claim fees.
RELAYER_PRIVATE_KEY=0x...`}</Code>
        <Note tone="warn">
          Never prefix it with <code>NEXT_PUBLIC_</code>. Use a throwaway account: the key has no authority over
          escrowed funds, but whoever holds it can spend its HBAR.
        </Note>
      </Section>

      <Section id="run" n={3} title="Run the app">
        <Code>{`yarn next:dev        # http://localhost:3000`}</Code>
        <p>
          The frontend already points at the live testnet deployment, so it works immediately. To deploy your own
          contracts, see <Link href="/docs/architecture">Architecture</Link> and run <code>yarn foundry:deploy</code>.
        </p>
      </Section>

      <Section id="sauce" n={4} title="Get test SAUCE">
        <p>The app sends SAUCE, so the sending wallet needs some.</p>
        <p>
          The easiest way is the <a href="https://testnet.saucerswap.finance/">SaucerSwap testnet app</a>: connect a
          wallet such as HashPack, make sure it is on <strong>Testnet</strong>, and swap HBAR for SAUCE. If it asks to
          associate SAUCE with your account, approve it.
        </p>
        <p>From a terminal instead, with a funded testnet key:</p>
        <Code>{`ME=<your 0x address>; KEY=<your private key>; RPC=https://testnet.hashio.io/api
SAUCE=0x0000000000000000000000000000000000120f46
WHBAR=0x0000000000000000000000000000000000003aD2
ROUTER=0x0000000000000000000000000000000000004b40   # SaucerSwap V1 router, 0.0.19264

# associate the token with your account, then swap 20 HBAR for SAUCE
cast send 0x0000000000000000000000000000000000000167 "associateToken(address,address)" $ME $SAUCE \\
  --private-key $KEY --rpc-url $RPC --legacy --gas-limit 1000000
cast send $ROUTER "swapExactETHForTokens(uint256,address[],address,uint256)" 1 "[$WHBAR,$SAUCE]" $ME \\
  $(( $(date +%s) + 600 )) --value 20ether --private-key $KEY --rpc-url $RPC --legacy --gas-limit 1500000`}</Code>
        <Note>
          Use the WHBAR <strong>token</strong> (<code>0x…3aD2</code>) in swap paths. The WHBAR helper at{" "}
          <code>0x…3aD1</code> reverts in <code>getAmountsOut</code>.
        </Note>
      </Section>

      <Section id="send" n={5} title="Send a gift">
        <ol className="steps">
          <li>Connect a wallet on the home page.</li>
          <li>Enter an amount, pick an expiry (1, 7 or 30 days) and who keeps the yield.</li>
          <li>
            Click <strong>Create gift link</strong>. Your wallet signs two transactions: an approval of the source for
            the amount plus a 0.00001 SAUCE rounding reserve, then <code>createLink</code> with the 1.5 HBAR prepaid
            network fee attached.
          </li>
          <li>Copy the link or show its QR code.</li>
        </ol>
        <p>
          The SAUCE is now staked in SaucerSwap and the link is worth slightly more every block. Your open links are
          listed under <strong>My links</strong>, where you can cancel them.
        </p>
      </Section>

      <Section id="claim" n={6} title="Claim it with no wallet">
        <p>
          Open the link in a private window or on a phone. The claim page shows no wallet button and no network chrome,
          only the gift, growing.
        </p>
        <ol className="steps">
          <li>
            Choose <strong>New wallet</strong>, <strong>My wallet</strong> or <strong>Address</strong>. A new wallet is
            a real ED25519 Hedera account, generated in the browser.
          </li>
          <li>Save the private key it shows, then tick the box.</li>
          <li>
            Tap <strong>Claim gift</strong>. The relayer creates the account, submits the claim, and the gift arrives.
          </li>
        </ol>
        <p>
          The success screen shows the account ID and the key in the 96-character DER form HashPack imports. Choose{" "}
          <strong>Testnet</strong> on HashPack&apos;s import screen and the gift is there.
        </p>
      </Section>

      <Section id="proof" n={7} title="Prove it on testnet">
        <p>One command runs the whole flow against testnet and prints HashScan links:</p>
        <Code>{`yarn foundry:demo`}</Code>
        <p>
          It needs <code>DEPLOYER_PRIVATE_KEY</code> in <code>packages/foundry/.env</code> and at least 4 SAUCE in that
          account. It creates a link, claims it to an address Hedera has never seen, then creates and cancels a second
          one. The run behind the README, on 3 October 2026:
        </p>
        <Table
          head={["Step", "Transaction"]}
          rows={[
            [
              "createLink: 2 SAUCE staked, 1.5 HBAR fee prepaid",
              <a key="1" href={tx("0x11cf2f7c125e97cf798e5f532bfd5854df7958d992caf2a7fc18739c79619005")}>
                0x11cf2f7c…
              </a>,
            ],
            [
              "claim to a never-seen address: 2.000009 SAUCE received",
              <a key="2" href={tx("0xfda1fe45597f7ba0b8c444ff9b3b185c796e1805cd8ec13de91437ec815ca7af")}>
                0xfda1fe45…
              </a>,
            ],
            [
              "Account created by that claim",
              <a key="3" href="https://hashscan.io/testnet/account/0.0.10830206">
                0.0.10830206
              </a>,
            ],
            [
              "Cancel a second link: SAUCE and fee return",
              <a key="4" href={tx("0xa69f39d640214bdac87911671a1199f0e8f492bbedd046f88e3ebf56da9561af")}>
                0xa69f39d6…
              </a>,
            ],
          ]}
        />
      </Section>

      <Section id="commands" title="Command reference">
        <Table
          head={["Command", "What it does"]}
          rows={[
            [<code key="a">yarn next:dev</code>, "Run the frontend on http://localhost:3000"],
            [<code key="b">yarn next:build</code>, "Production build"],
            [<code key="c">yarn next:test</code>, "41 Vitest tests: claim URLs, EIP-712 signing, ED25519 wallets"],
            [<code key="d">yarn next:lint</code>, "ESLint with zero warnings allowed"],
            [<code key="e">yarn foundry:test</code>, "54 contract tests, including fuzz and stateful invariants"],
            [<code key="f">yarn foundry:fork</code>, "Anvil forking testnet (chain id 296) with the SaucerSwap source"],
            [<code key="g">yarn foundry:chain</code>, "Plain Anvil with IdleSource (no yield)"],
            [<code key="h">yarn foundry:deploy --network hedera_testnet</code>, "Deploy your own contracts"],
            [<code key="i">yarn foundry:demo</code>, "Live testnet proof: create, claim to a new address, cancel"],
          ]}
        />
        <p>
          If <code>forge</code> reports &quot;No tests found&quot; right after a successful build, run{" "}
          <code>forge clean</code> and build again.
        </p>
      </Section>
    </DocPageShell>
  );
}
