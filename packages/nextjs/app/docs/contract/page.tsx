import Link from "next/link";
import { Code, DocPageShell, Note, Section, Table } from "../_components";

export const metadata = { title: "Contract reference" };

export default function ContractPage() {
  return (
    <DocPageShell
      slug="contract"
      lead={
        <p>
          Every function on <code>YieldLinks.sol</code> and on the source behind it, what it does, and the details that
          will surprise you. <code>YieldLinks</code> is <code>EIP712(&quot;YieldLinks&quot;, &quot;1&quot;)</code> and{" "}
          <code>ReentrancyGuard</code>. It has no owner and nothing to upgrade.
        </p>
      }
    >
      <Section id="constants" n={1} title="Constants">
        <p>None of these have setters. Immutables are fixed in the constructor.</p>
        <Table
          head={["Name", "Value", "Why"]}
          rows={[
            [
              <code key="a">CLAIM_TYPEHASH</code>,
              <code key="a2">Claim(address linkKey,address recipient)</code>,
              "The EIP-712 type a claim signs",
            ],
            [
              <code key="b">VIRTUAL</code>,
              "1e3",
              "Virtual shares and assets that blunt the first-depositor inflation attack",
            ],
            [<code key="c">MAX_DURATION</code>, "365 days", "The longest expiry a link may have"],
            [
              <code key="d">ROUNDING_DUST</code>,
              "10 base units",
              "Taken from the sender on top of the gift so rounding never leaves the recipient short",
            ],
            [<code key="e">SOURCE</code>, "immutable", "The IYieldSource that holds every escrowed token"],
            [<code key="f">CHARITY</code>, "immutable", "Receives yield on Charity links. Zero disables that policy."],
          ]}
        />
      </Section>

      <Section id="create-link" n={2} title="createLink">
        <Code lang="Solidity">{`function createLink(address linkKey, address token, uint256 amount, uint64 expiry, YieldPolicy policy)
    external payable returns (uint256 shares);`}</Code>
        <p>
          Escrows <code>amount + ROUNDING_DUST</code> of <code>token</code> against <code>linkKey</code> and mints the
          link its shares of that token&apos;s pool. <code>msg.value</code> is the prepaid network fee, stored in
          tinybar.
        </p>
        <ul>
          <li>
            Approve the <strong>source</strong> for <code>amount + 10</code> first. The source pulls the tokens with{" "}
            <code>transferFrom</code>.
          </li>
          <li>
            Reverts with <code>InvalidLinkKey</code> for the zero address, <code>LinkExists</code> if the key was ever
            used, <code>InvalidAmount</code> for zero (or an amount that would mint zero shares),{" "}
            <code>InvalidExpiry</code> outside <code>(now, now + 365 days]</code>, and <code>NoCharity</code> for a
            Charity link when no charity is set.
          </li>
        </ul>
      </Section>

      <Section id="claim-fn" n={3} title="claim">
        <Code lang="Solidity">{`function claim(address linkKey, address recipient, bytes calldata signature) external;`}</Code>
        <p>
          Pays the link out to <code>recipient</code>. Anyone may submit it; normally the relayer does. The signature is
          the link key&apos;s EIP-712 signature over <code>(linkKey, recipient)</code>, bound to this chain and
          contract.
        </p>
        <ol className="steps">
          <li>
            Checks: the link is <code>Open</code> (<code>LinkNotOpen</code>), not expired (<code>LinkExpired</code>),
            the recipient is not zero (<code>InvalidRecipient</code>), and the signer is <code>linkKey</code> (
            <code>InvalidSignature</code>).
          </li>
          <li>
            Settles: prices the shares, burns them, zeroes the fee, marks the link <code>Claimed</code>.
          </li>
          <li>Pays the recipient, then any yield to the sender or charity, through the source.</li>
          <li>
            Pays the prepaid fee to <code>msg.sender</code>, the submitter.
          </li>
        </ol>
        <Note>
          The link is closed before any external call. A reentrant call finds it <code>Claimed</code> and reverts, and{" "}
          <code>nonReentrant</code> stops it earlier anyway.
        </Note>
      </Section>

      <Section id="refund-fn" n={4} title="refund">
        <Code lang="Solidity">{`function refund(address linkKey) external;`}</Code>
        <p>
          Returns everything, principal plus yield plus the prepaid fee, to the sender. The sender may call it at any
          time; after expiry anyone may. Reverts with <code>NotRefundable</code> when a stranger calls before expiry.
        </p>
      </Section>

      <Section id="views" n={5} title="Views and fees">
        <Table
          head={["Function", "Returns"]}
          rows={[
            [
              <code key="a">claimable(linkKey)</code>,
              "(assets, principal): the link's value now and what it started with. Zero once closed.",
            ],
            [
              <code key="b">links(linkKey)</code>,
              "The stored Link: sender, expiry, status, policy, token, createdAt, principal, shares, fee",
            ],
            [<code key="c">totalShares(token)</code>, "Shares outstanding in a token's pool"],
            [
              <code key="d">pendingFees(sender)</code>,
              "Fees that could not be delivered, credited to the link's sender",
            ],
            [<code key="e">withdrawPendingFees(to)</code>, "Sends the caller's pending fees to any address"],
          ]}
        />
        <p>
          <code>claimable</code> is what the claim page polls to show the gift growing. Between reads the UI ticks an
          estimate, labelled as one.
        </p>
      </Section>

      <Section id="events" n={6} title="Events">
        <Code lang="Solidity">{`event LinkCreated(address indexed linkKey, address indexed sender, address token,
                  uint256 amount, uint64 expiry, YieldPolicy policy, uint256 fee);
event LinkClaimed(address indexed linkKey, address indexed recipient, uint256 toRecipient,
                  address yieldTo, uint256 yieldAmount);
event LinkRefunded(address indexed linkKey, address indexed sender, uint256 amount);
event FeePaid(address indexed linkKey, address indexed to, uint256 amount);
event FeeWithdrawn(address indexed sender, address indexed to, uint256 amount);`}</Code>
        <p>
          <code>LinkClaimed</code> splits the payout: <code>toRecipient</code> and, for Sender or Charity links,{" "}
          <code>yieldAmount</code> sent to <code>yieldTo</code>.
        </p>
      </Section>

      <Section id="errors" n={7} title="Errors">
        <Code lang="Solidity">{`error InvalidLinkKey();   error InvalidAmount();     error InvalidExpiry();
error InvalidRecipient(); error InvalidSignature();  error LinkExists();
error LinkNotOpen();      error LinkExpired();       error NotRefundable();
error NoCharity();        error NothingToWithdraw(); error WithdrawFailed();`}</Code>
      </Section>

      <Section id="source" n={8} title="The source">
        <p>
          A source implements <code>IYieldSource</code> and inherits <code>ControlledSource</code>. It is the only
          contract that holds tokens.
        </p>
        <Table
          head={["Function", "Who may call it", "What it does"]}
          rows={[
            [<code key="a">totalAssets(token)</code>, "Anyone", "Value held, including yield"],
            [
              <code key="b">deposit(token, from, amount)</code>,
              "The controller",
              "Pulls from from and puts it to work",
            ],
            [
              <code key="c">withdraw(token, amount, to)</code>,
              "The controller",
              "Unwinds and pays to, by HIP-904 airdrop on Hedera",
            ],
            [
              <code key="d">setController(address)</code>,
              "The deployer, once",
              "Binds the source to one YieldLinks, forever",
            ],
            [
              <code key="e">withdrawHbar(to, amount)</code>,
              "The deployer",
              "Takes back the HBAR fee reserve. Cannot touch tokens.",
            ],
          ]}
        />
        <p>
          <code>SauceStakingSource</code> accepts only SAUCE (<code>UnsupportedToken</code> otherwise) and tolerates a
          rounding shortfall of at most 2 base units on a payout (<code>InsufficientAssets</code> beyond that). Writing
          your own is on <Link href="/docs/yield-sources">Add a yield source</Link>.
        </p>
      </Section>
    </DocPageShell>
  );
}
