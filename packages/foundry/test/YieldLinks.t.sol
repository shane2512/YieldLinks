// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { YieldLinks } from "../contracts/YieldLinks.sol";
import { IdleSource } from "../contracts/sources/IdleSource.sol";
import { ControlledSource } from "../contracts/sources/ControlledSource.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";

contract YieldLinksTest is Test {
    uint256 internal constant ONE = 1e6; // 1 USDC
    // Virtual shares keep a dust fraction of yield (about VIRTUAL / pool size) as inflation-attack insurance.
    uint256 internal constant DUST = 1e14; // 0.01%

    YieldLinks internal links;
    IdleSource internal source;
    MockUSDC internal usdc;

    address internal sender = makeAddr("sender");
    address internal recipient = makeAddr("recipient");
    address internal charity = makeAddr("charity");
    address internal relayer = makeAddr("relayer");

    uint256 internal keyA = 0xA11CE;
    uint256 internal keyB = 0xB0B;
    address internal linkA;
    address internal linkB;

    function setUp() public {
        usdc = new MockUSDC();
        source = new IdleSource();
        links = new YieldLinks(source, charity);
        source.setController(address(links));

        linkA = vm.addr(keyA);
        linkB = vm.addr(keyB);

        usdc.mint(sender, 1_000 * ONE);
        vm.prank(sender);
        usdc.approve(address(source), type(uint256).max);
    }

    // ---------------------------------------------------------------- helpers

    function _create(address key, uint256 amount, YieldLinks.YieldPolicy policy) internal {
        vm.prank(sender);
        links.createLink(key, address(usdc), amount, uint64(block.timestamp + 7 days), policy);
    }

    function _sign(uint256 pk, address key, address to) internal view returns (bytes memory) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("YieldLinks"),
                keccak256("1"),
                block.chainid,
                address(links)
            )
        );
        bytes32 structHash = keccak256(abi.encode(links.CLAIM_TYPEHASH(), key, to));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _accrue(uint256 amount) internal {
        usdc.mint(address(source), amount); // simulates lending interest
    }

    // ---------------------------------------------------------------- happy path

    function test_claim_paysRecipientInFull() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);
        assertEq(usdc.balanceOf(sender), 990 * ONE);

        vm.prank(relayer);
        links.claim(linkA, recipient, _sign(keyA, linkA, recipient));

        assertEq(usdc.balanceOf(recipient), 10 * ONE);
        assertEq(usdc.balanceOf(address(source)), 0);
    }

    function test_claim_recipientPolicy_recipientKeepsYield() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);
        _accrue(1 * ONE);

        links.claim(linkA, recipient, _sign(keyA, linkA, recipient));

        assertApproxEqRel(usdc.balanceOf(recipient), 11 * ONE, DUST);
    }

    function test_claim_senderPolicy_yieldGoesBackToSender() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Sender);
        _accrue(1 * ONE);

        links.claim(linkA, recipient, _sign(keyA, linkA, recipient));

        assertEq(usdc.balanceOf(recipient), 10 * ONE);
        assertApproxEqRel(usdc.balanceOf(sender), 991 * ONE, DUST);
    }

    function test_claim_charityPolicy_yieldGoesToCharity() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Charity);
        _accrue(1 * ONE);

        links.claim(linkA, recipient, _sign(keyA, linkA, recipient));

        assertEq(usdc.balanceOf(recipient), 10 * ONE);
        assertApproxEqRel(usdc.balanceOf(charity), 1 * ONE, DUST);
    }

    function test_claimable_growsWithYield() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);
        (uint256 before_,) = links.claimable(linkA);
        _accrue(1 * ONE);
        (uint256 after_, uint256 principal) = links.claimable(linkA);

        assertEq(principal, 10 * ONE);
        assertGt(after_, before_);
    }

    function test_pooledYield_isSharedProportionally() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);
        _create(linkB, 30 * ONE, YieldLinks.YieldPolicy.Recipient);
        _accrue(4 * ONE); // 10% on 40

        links.claim(linkA, recipient, _sign(keyA, linkA, recipient));
        links.claim(linkB, relayer, _sign(keyB, linkB, relayer));

        assertApproxEqRel(usdc.balanceOf(recipient), 11 * ONE, DUST);
        assertApproxEqRel(usdc.balanceOf(relayer), 33 * ONE, DUST);
    }

    function test_createLink_recordsCreationTime() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);
        (,,,,, uint64 createdAt,,) = links.links(linkA);
        assertEq(createdAt, block.timestamp);
    }

    // ---------------------------------------------------------------- attacks

    function test_claim_revertsOnWrongSigner() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);
        bytes memory forged = _sign(keyB, linkA, recipient);

        vm.expectRevert(YieldLinks.InvalidSignature.selector);
        links.claim(linkA, recipient, forged);
    }

    function test_claim_frontRunnerCannotRedirectFunds() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);
        bytes memory sig = _sign(keyA, linkA, recipient); // visible in the mempool

        vm.expectRevert(YieldLinks.InvalidSignature.selector);
        links.claim(linkA, relayer, sig); // attacker swaps in their own address

        links.claim(linkA, recipient, sig);
        assertEq(usdc.balanceOf(recipient), 10 * ONE);
    }

    function test_claim_cannotBeReplayed() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);
        bytes memory sig = _sign(keyA, linkA, recipient);
        links.claim(linkA, recipient, sig);

        vm.expectRevert(YieldLinks.LinkNotOpen.selector);
        links.claim(linkA, recipient, sig);
    }

    function test_createLink_keyCanNeverBeReused() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);
        links.claim(linkA, recipient, _sign(keyA, linkA, recipient));

        vm.prank(sender);
        vm.expectRevert(YieldLinks.LinkExists.selector);
        links.createLink(linkA, address(usdc), ONE, uint64(block.timestamp + 1 days), YieldLinks.YieldPolicy.Recipient);
    }

    function test_firstDepositorInflation_costsAttackerMoreThanVictimLoses() public {
        usdc.mint(relayer, 1_000_000 * ONE);
        usdc.mint(sender, 100_000 * ONE);
        vm.startPrank(relayer);
        usdc.approve(address(source), type(uint256).max);
        links.createLink(linkB, address(usdc), 1, uint64(block.timestamp + 7 days), YieldLinks.YieldPolicy.Recipient);
        assertTrue(usdc.transfer(address(source), 100_000 * ONE)); // donation to skew the share price
        vm.stopPrank();

        _create(linkA, 100_000 * ONE, YieldLinks.YieldPolicy.Recipient);
        (uint256 value,) = links.claimable(linkA);

        assertGt(value, 99_000 * ONE); // victim keeps >99% of their deposit
    }

    // ---------------------------------------------------------------- expiry and refund

    function test_claim_revertsAfterExpiry() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);
        bytes memory sig = _sign(keyA, linkA, recipient);
        vm.warp(block.timestamp + 7 days);

        vm.expectRevert(YieldLinks.LinkExpired.selector);
        links.claim(linkA, recipient, sig);
    }

    function test_refund_anyoneCanTriggerAfterExpiry_paysSenderWithYield() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);
        _accrue(1 * ONE);
        vm.warp(block.timestamp + 7 days);

        vm.prank(relayer);
        links.refund(linkA);

        assertApproxEqRel(usdc.balanceOf(sender), 1_001 * ONE, DUST);
    }

    function test_refund_senderCanCancelBeforeExpiry() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);

        vm.prank(sender);
        links.refund(linkA);

        assertEq(usdc.balanceOf(sender), 1_000 * ONE);
    }

    function test_refund_strangerCannotCancelBeforeExpiry() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);

        vm.prank(relayer);
        vm.expectRevert(YieldLinks.NotRefundable.selector);
        links.refund(linkA);
    }

    function test_refund_cannotRefundTwice() public {
        _create(linkA, 10 * ONE, YieldLinks.YieldPolicy.Recipient);
        vm.prank(sender);
        links.refund(linkA);

        vm.prank(sender);
        vm.expectRevert(YieldLinks.LinkNotOpen.selector);
        links.refund(linkA);
    }

    // ---------------------------------------------------------------- validation

    function test_createLink_rejectsBadInputs() public {
        vm.startPrank(sender);
        uint64 ok = uint64(block.timestamp + 1 days);

        vm.expectRevert(YieldLinks.InvalidLinkKey.selector);
        links.createLink(address(0), address(usdc), ONE, ok, YieldLinks.YieldPolicy.Recipient);

        vm.expectRevert(YieldLinks.InvalidAmount.selector);
        links.createLink(linkA, address(usdc), 0, ok, YieldLinks.YieldPolicy.Recipient);

        vm.expectRevert(YieldLinks.InvalidExpiry.selector);
        links.createLink(linkA, address(usdc), ONE, uint64(block.timestamp), YieldLinks.YieldPolicy.Recipient);

        vm.expectRevert(YieldLinks.InvalidExpiry.selector);
        links.createLink(
            linkA, address(usdc), ONE, uint64(block.timestamp + 366 days), YieldLinks.YieldPolicy.Recipient
        );
        vm.stopPrank();
    }

    function test_createLink_charityPolicyNeedsCharity() public {
        YieldLinks noCharity = new YieldLinks(source, address(0));
        vm.prank(sender);
        vm.expectRevert(YieldLinks.NoCharity.selector);
        noCharity.createLink(
            linkA, address(usdc), ONE, uint64(block.timestamp + 1 days), YieldLinks.YieldPolicy.Charity
        );
    }

    function test_source_isBoundToOneController() public {
        vm.expectRevert(ControlledSource.ControllerAlreadySet.selector);
        source.setController(address(this));

        vm.prank(relayer);
        vm.expectRevert(ControlledSource.NotController.selector);
        source.withdraw(address(usdc), 1, relayer);
    }

    // ---------------------------------------------------------------- fuzz / solvency

    /// Whatever yield accrues, the pool can always pay every open link in full.
    function testFuzz_poolStaysSolvent(uint96 a, uint96 b, uint96 yield_) public {
        a = uint96(bound(a, 1, 400 * ONE));
        b = uint96(bound(b, 1, 400 * ONE));
        yield_ = uint96(bound(yield_, 0, 100 * ONE));

        _create(linkA, a, YieldLinks.YieldPolicy.Recipient);
        _create(linkB, b, YieldLinks.YieldPolicy.Recipient);
        _accrue(yield_);

        (uint256 va,) = links.claimable(linkA);
        (uint256 vb,) = links.claimable(linkB);
        assertLe(va + vb, usdc.balanceOf(address(source)));
        assertGe(va + 1, a); // yield never makes a link worth less than principal (rounding aside)

        links.claim(linkA, recipient, _sign(keyA, linkA, recipient));
        links.claim(linkB, relayer, _sign(keyB, linkB, relayer));

        // Conservation: every unit is either paid out or left in the source as dust.
        uint256 paid = usdc.balanceOf(recipient) + usdc.balanceOf(relayer);
        assertEq(paid + usdc.balanceOf(address(source)), uint256(a) + b + yield_);
    }
}
