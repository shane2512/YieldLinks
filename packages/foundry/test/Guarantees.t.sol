// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, Vm } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { YieldLinks } from "../contracts/YieldLinks.sol";
import { IdleSource } from "../contracts/sources/IdleSource.sol";
import { SauceStakingSource } from "../contracts/sources/SauceStakingSource.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";
import { MockMothership } from "./mocks/MockMothership.sol";

/// Signs claims the way the link key does, shared by both suites below.
abstract contract ClaimSigner is Test {
    function _signClaim(YieldLinks links, uint256 pk, address recipient) internal view returns (bytes memory) {
        address key = vm.addr(pk);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("YieldLinks"),
                keccak256("1"),
                block.chainid,
                address(links)
            )
        );
        bytes32 structHash = keccak256(abi.encode(links.CLAIM_TYPEHASH(), key, recipient));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }
}

/// "Send 5, the recipient receives at least 5", even where the staking pool's arithmetic rounds down.
contract RecipientReceivesAtLeastTheAmountTest is ClaimSigner {
    uint256 internal constant ONE = 1e6;
    uint256 internal constant PK = 0xA11CE;

    MockUSDC internal sauce;
    MockMothership internal pool;
    SauceStakingSource internal source;
    YieldLinks internal links;

    address internal sender = makeAddr("sender");
    address internal recipient = makeAddr("recipient");

    function setUp() public {
        sauce = new MockUSDC();
        pool = new MockMothership(ERC20(address(sauce)));
        source = new SauceStakingSource(pool);
        links = new YieldLinks(source, makeAddr("charity"));
        source.setController(address(links));

        sauce.mint(address(this), 1_000 * ONE);
        sauce.approve(address(pool), type(uint256).max);
        pool.enter(1_000 * ONE);
        // The testnet pool's price is about 1.003 SAUCE per xSAUCE, so rounding is real, not hypothetical.
        sauce.mint(address(pool), 3 * ONE);

        sauce.mint(sender, 1_000_000 * ONE);
        vm.prank(sender);
        sauce.approve(address(source), type(uint256).max);
    }

    function _sendAndClaim(uint256 amount, YieldLinks.YieldPolicy policy) internal returns (uint256 received) {
        vm.prank(sender);
        links.createLink(vm.addr(PK), address(sauce), amount, uint64(block.timestamp + 1 days), policy);
        links.claim(vm.addr(PK), recipient, _signClaim(links, PK, recipient));
        return sauce.balanceOf(recipient);
    }

    function test_fiveSauceSent_atLeastFiveReceived() public {
        assertGe(_sendAndClaim(5 * ONE, YieldLinks.YieldPolicy.Recipient), 5 * ONE);
    }

    /// Regression: a tiny link in a nearly empty source, with the pool priced so the deposit rounds down by two units.
    /// The share formula valued the link at 15 while the source held 14, so claim and refund both reverted.
    function test_tinyLinkInAPriceyPool_claimAndRefundDoNotRevert() public {
        sauce.mint(address(pool), 352_510_043); // pool price about 1.3555 SAUCE per xSAUCE

        vm.prank(sender);
        links.createLink(
            vm.addr(PK), address(sauce), 6, uint64(block.timestamp + 1 days), YieldLinks.YieldPolicy.Recipient
        );
        (uint256 value,) = links.claimable(vm.addr(PK));
        assertLe(value, source.totalAssets(address(sauce)), "a link is never worth more than the source holds");

        links.claim(vm.addr(PK), recipient, _signClaim(links, PK, recipient));
        assertGe(sauce.balanceOf(recipient), 6, "and the recipient still receives at least the amount");
    }

    function test_tinyLinkInAPriceyPool_senderCanStillCancel() public {
        sauce.mint(address(pool), 352_510_043);
        vm.startPrank(sender);
        links.createLink(
            vm.addr(PK), address(sauce), 6, uint64(block.timestamp + 1 days), YieldLinks.YieldPolicy.Recipient
        );
        links.refund(vm.addr(PK));
        vm.stopPrank();
    }

    function test_withoutTheReserve_theSameFlowWouldFallShort() public {
        // Documents why the reserve exists: depositing exactly 5 SAUCE into this pool and reading it back loses a unit.
        sauce.mint(address(this), 5 * ONE);
        sauce.approve(address(pool), type(uint256).max);
        uint256 before = pool.X_SAUCE_TOKEN().balanceOf(address(this));
        pool.enter(5 * ONE);
        uint256 minted = pool.X_SAUCE_TOKEN().balanceOf(address(this)) - before;
        uint256 worth = (minted * sauce.balanceOf(address(pool))) / pool.X_SAUCE_TOKEN().totalSupply();
        assertLt(worth, 5 * ONE, "plain staking rounds down");
    }

    function testFuzz_recipientNeverReceivesLessThanTheAmount(uint96 amountSeed, uint96 rewardsSeed, uint8 policySeed)
        public
    {
        uint256 amount = bound(amountSeed, 1, 100_000 * ONE);
        sauce.mint(address(pool), bound(rewardsSeed, 0, 500 * ONE)); // any pool price
        YieldLinks.YieldPolicy policy = YieldLinks.YieldPolicy(policySeed % 3);

        assertGe(_sendAndClaim(amount, policy), amount);
    }

    function testFuzz_senderGetsEverythingBackOnRefund(uint96 amountSeed, uint96 rewardsSeed) public {
        uint256 amount = bound(amountSeed, 1, 100_000 * ONE);
        sauce.mint(address(pool), bound(rewardsSeed, 0, 500 * ONE));
        uint256 before = sauce.balanceOf(sender);

        vm.prank(sender);
        links.createLink(
            vm.addr(PK), address(sauce), amount, uint64(block.timestamp + 1 days), YieldLinks.YieldPolicy.Recipient
        );
        vm.prank(sender);
        links.refund(vm.addr(PK));

        // At most a few base units are lost to rounding, never more than the reserve the sender added.
        assertGe(sauce.balanceOf(sender) + links.ROUNDING_DUST(), before);
    }
}

/// A sender who rejects the native coin, to prove a refund can never be blocked or lose the fee.
contract NoReceiveSender {
    function create(YieldLinks links, address key, MockUSDC token, address source, uint256 amount) external payable {
        token.approve(source, type(uint256).max);
        links.createLink{ value: msg.value }(
            key, address(token), amount, uint64(block.timestamp + 1 days), YieldLinks.YieldPolicy.Recipient
        );
    }

    function cancel(YieldLinks links, address key) external {
        links.refund(key);
    }

    function withdraw(YieldLinks links, address payable to) external {
        links.withdrawPendingFees(to);
    }
}

/// A claim submitter that cannot receive the native coin.
contract NoReceiveSubmitter {
    function submit(YieldLinks links, address key, address recipient, bytes calldata signature) external {
        links.claim(key, recipient, signature);
    }
}

/// The sender prepays the network fee; whoever submits the claim is reimbursed, and nothing is ever stuck.
contract PrepaidFeeTest is ClaimSigner {
    uint256 internal constant ONE = 1e6;
    uint256 internal constant PK = 0xA11CE;
    uint256 internal constant FEE = 1.5 ether;

    YieldLinks internal links;
    IdleSource internal source;
    MockUSDC internal usdc;

    address internal sender = makeAddr("sender");
    address internal recipient = makeAddr("recipient");
    address internal relayer = makeAddr("relayer");
    address internal stranger = makeAddr("stranger");
    address internal key;

    function setUp() public {
        usdc = new MockUSDC();
        source = new IdleSource();
        links = new YieldLinks(source, makeAddr("charity"));
        source.setController(address(links));
        key = vm.addr(PK);

        usdc.mint(sender, 1_000 * ONE);
        vm.deal(sender, 10 ether);
        vm.prank(sender);
        usdc.approve(address(source), type(uint256).max);
    }

    function _create(uint256 fee) internal {
        vm.prank(sender);
        links.createLink{ value: fee }(
            key, address(usdc), 10 * ONE, uint64(block.timestamp + 1 days), YieldLinks.YieldPolicy.Recipient
        );
    }

    function _feeOf(address linkKey) internal view returns (uint128 fee) {
        (,,,,,,,, fee) = links.links(linkKey);
    }

    function test_createLink_holdsTheFeeAndTakesItFromTheSenderWallet() public {
        uint256 before = sender.balance;
        _create(FEE);

        assertEq(before - sender.balance, FEE, "the sender pays the fee");
        assertEq(address(links).balance, FEE, "the contract holds it for the link");
        assertEq(_feeOf(key), FEE);
    }

    function test_claim_paysTheFeeToWhoeverSubmitsIt() public {
        _create(FEE);

        bytes memory signature = _signClaim(links, PK, recipient);
        vm.recordLogs();
        vm.prank(relayer);
        links.claim(key, recipient, signature);

        // LinkClaimed is emitted first; find FeePaid among the logs.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("FeePaid(address,address,uint256)")) {
                found = true;
                assertEq(address(uint160(uint256(logs[i].topics[2]))), relayer);
                assertEq(abi.decode(logs[i].data, (uint256)), FEE);
            }
        }
        assertTrue(found, "FeePaid emitted");

        assertEq(relayer.balance, FEE, "the relayer is reimbursed from the sender's deposit");
        assertEq(address(links).balance, 0);
        assertEq(_feeOf(key), 0);
        assertEq(recipient.balance, 0, "the recipient pays nothing and receives no fee");
    }

    function test_cancel_returnsTheFeeToTheSender() public {
        _create(FEE);
        uint256 afterCreate = sender.balance;

        vm.prank(sender);
        links.refund(key);

        assertEq(sender.balance - afterCreate, FEE);
        assertEq(address(links).balance, 0);
    }

    function test_expiredLink_strangerRefundStillReturnsTheFeeToTheSender() public {
        _create(FEE);
        uint256 afterCreate = sender.balance;
        vm.warp(block.timestamp + 1 days);

        vm.prank(stranger);
        links.refund(key);

        assertEq(sender.balance - afterCreate, FEE, "not the stranger who triggered it");
        assertEq(stranger.balance, 0);
    }

    function test_noFeeIsAllowed() public {
        _create(0);
        vm.prank(relayer);
        links.claim(key, recipient, _signClaim(links, PK, recipient));
        assertEq(relayer.balance, 0);
        assertEq(usdc.balanceOf(recipient), 10 * ONE + links.ROUNDING_DUST());
    }

    function test_claim_submitterThatCannotReceive_creditsTheSenderInstead() public {
        _create(FEE);
        NoReceiveSubmitter submitter = new NoReceiveSubmitter();

        submitter.submit(links, key, recipient, _signClaim(links, PK, recipient));

        assertEq(usdc.balanceOf(recipient), 10 * ONE + links.ROUNDING_DUST(), "the claim itself still succeeds");
        assertEq(links.pendingFees(sender), FEE, "the fee is credited to the sender, not lost");

        address payable dest = payable(makeAddr("dest"));
        vm.prank(sender);
        links.withdrawPendingFees(dest);
        assertEq(dest.balance, FEE);
        assertEq(links.pendingFees(sender), 0);

        vm.prank(sender);
        vm.expectRevert(YieldLinks.NothingToWithdraw.selector);
        links.withdrawPendingFees(dest);
    }

    function test_refund_senderThatRejectsTheNativeCoin_cannotBeBlockedOrLoseTheFee() public {
        NoReceiveSender picky = new NoReceiveSender();
        usdc.mint(address(picky), 1_000 * ONE);
        vm.deal(address(picky), 0);
        picky.create{ value: FEE }(links, key, usdc, address(source), 10 * ONE);
        assertEq(address(links).balance, FEE);

        picky.cancel(links, key);

        assertEq(usdc.balanceOf(address(picky)), 1_000 * ONE - links.ROUNDING_DUST() + links.ROUNDING_DUST());
        assertEq(links.pendingFees(address(picky)), FEE, "the refund went through and the fee waits for them");

        address payable dest = payable(makeAddr("dest"));
        picky.withdraw(links, dest);
        assertEq(dest.balance, FEE);
        assertEq(address(links).balance, 0);
    }

    function test_withdrawPendingFees_revertsWhenNothingIsOwed() public {
        vm.prank(stranger);
        vm.expectRevert(YieldLinks.NothingToWithdraw.selector);
        links.withdrawPendingFees(payable(stranger));
    }

    function test_theFeeCanOnlyBeCollectedOnce() public {
        _create(FEE);
        bytes memory signature = _signClaim(links, PK, recipient);
        vm.prank(relayer);
        links.claim(key, recipient, signature);

        vm.prank(relayer);
        vm.expectRevert(YieldLinks.LinkNotOpen.selector);
        links.claim(key, recipient, signature);
        assertEq(relayer.balance, FEE);
    }
}
