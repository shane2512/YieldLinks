import Link from "next/link";
import { Code, DocPageShell, Note, Section } from "../_components";

export const metadata = { title: "Add a yield source" };

export default function YieldSourcesPage() {
  return (
    <DocPageShell
      slug="yield-sources"
      lead={
        <p>
          This is the part you change. <code>YieldLinks</code> is finished: it tracks links, checks signatures and keeps
          the books. Where the tokens sit while they wait is one contract with three functions.
        </p>
      }
    >
      <Section id="interface" n={1} title="The interface">
        <Code lang="Solidity">{`interface IYieldSource {
    /// Underlying-token value currently held for the controller, including accrued yield.
    function totalAssets(address token) external view returns (uint256);

    /// Pulls \`amount\` of \`token\` from \`from\` (who must have approved this source) and puts it to work.
    function deposit(address token, address from, uint256 amount) external;

    /// Sends \`amount\` of \`token\` to \`to\`, unwinding from the yield venue if needed.
    function withdraw(address token, uint256 amount, address to) external;
}`}</Code>
        <p>Three rules follow, and the tests check each one:</p>
        <ul>
          <li>
            <strong>The source is the only token holder.</strong> <code>YieldLinks</code> never holds or approves a
            token.
          </li>
          <li>
            <strong>Only the controller moves funds.</strong> Inherit <code>ControlledSource</code> and guard{" "}
            <code>deposit</code> and <code>withdraw</code> with <code>onlyController</code>.
          </li>
          <li>
            <strong>Never pay more than you report.</strong> Round so a withdrawal cannot exceed{" "}
            <code>totalAssets</code>, or claims revert.
          </li>
        </ul>
      </Section>

      <Section id="smallest" n={2} title="The smallest source">
        <p>
          <code>IdleSource.sol</code>, complete. It earns nothing, and it is the starting point for every new venue.
        </p>
        <Code lang="Solidity">{`contract IdleSource is ControlledSource {
    using SafeERC20 for IERC20;

    function totalAssets(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function deposit(address token, address from, uint256 amount) external onlyController {
        HtsLib.associate(token);
        IERC20(token).safeTransferFrom(from, address(this), amount);
    }

    function withdraw(address token, uint256 amount, address to) external onlyController {
        _send(IERC20(token), to, amount);
    }
}`}</Code>
        <p>
          <code>_send</code> comes from <code>ControlledSource</code>: a HIP-904 airdrop on Hedera, a plain ERC-20
          transfer anywhere else. <code>HtsLib.associate</code> accepts &quot;already associated&quot; and does nothing
          off Hedera, so the same contract runs in <code>forge test</code>.
        </p>
      </Section>

      <Section id="real" n={3} title="A real venue">
        <p>
          <code>SauceStakingSource.sol</code> is 77 lines. What it adds over the idle source is everything SaucerSwap
          taught us:
        </p>
        <ul>
          <li>
            <strong>Value at the pool ratio.</strong> <code>totalAssets</code> is idle SAUCE plus xSAUCE held × SAUCE in
            the pool ÷ xSAUCE supply.
          </li>
          <li>
            <strong>Two allowances.</strong> <code>enter</code> pulls SAUCE, so approve SAUCE. <code>leave</code> also
            pulls, so approve xSAUCE too. Without the second, <code>leave</code> reverts with no useful message.
          </li>
          <li>
            <strong>Round shares up when unstaking</strong> so the payout is covered, but never beyond what the source
            holds.
          </li>
          <li>
            <strong>Bound the shortfall.</strong> Two payouts from one link can come up a unit short. Accept at most{" "}
            <code>MAX_ROUNDING_SHORTFALL = 2</code>, revert beyond it.
          </li>
          <li>
            <strong>Reject other tokens</strong> with <code>UnsupportedToken</code>.
          </li>
        </ul>
      </Section>

      <Section id="steps" n={4} title="Ship it">
        <ol className="steps">
          <li>
            Create <code>contracts/sources/MySource.sol</code> inheriting <code>ControlledSource</code>.
          </li>
          <li>
            Implement the three functions. Associate any HTS token it holds with <code>HtsLib.associate</code>.
          </li>
          <li>
            Add a mock venue under <code>test/mocks/</code> and tests mirroring <code>SauceStakingSource.t.sol</code>:
            deposit, yield reaching the link, claim, refund, wrong token, non-controller.
          </li>
          <li>
            Select it in <code>script/Deploy.s.sol</code> and deploy. The frontend picks it up from{" "}
            <code>deployedContracts.ts</code>.
          </li>
          <li>
            If the token changes, update the <code>SAUCE()</code> read in <code>CreateLinkForm.tsx</code> and{" "}
            <code>TOKEN_DECIMALS</code> in <code>utils/yieldlinks</code>.
          </li>
        </ol>
        <Code>{`yarn foundry:test
yarn foundry:deploy --network hedera_testnet`}</Code>
        <Note tone="warn">Never hardcode decimals. SAUCE and USDC have 6. Read them from the token where you can.</Note>
      </Section>

      <Section id="bonzo" n={5} title="Next candidate: Bonzo">
        <p>
          Bonzo Finance, an Aave v2 fork, was the first choice and is not used today (see{" "}
          <Link href="/docs/hedera-notes#dead-ends">dead ends</Link>). If its testnet is fixed, a source is small:
        </p>
        <Code lang="Solidity">{`contract BonzoSource is ControlledSource {
    // deposit:     transferFrom, approve the pool, pool.deposit(token, amount, address(this), 0)
    // withdraw:    pool.withdraw(token, amount, address(this)), then _send(token, to, amount)
    // totalAssets: the aToken balance of this contract
}`}</Code>
      </Section>
    </DocPageShell>
  );
}
