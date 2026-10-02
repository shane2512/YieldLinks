// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { YieldLinks } from "../contracts/YieldLinks.sol";
import { SauceStakingSource } from "../contracts/sources/SauceStakingSource.sol";
import { ControlledSource } from "../contracts/sources/ControlledSource.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";
import { MockMothership } from "./mocks/MockMothership.sol";

contract SauceStakingSourceTest is Test {
    uint256 internal constant ONE = 1e6;

    MockUSDC internal sauce; // reuse the 6-decimal mock as SAUCE
    MockMothership internal mothership;
    SauceStakingSource internal source;
    YieldLinks internal links;

    address internal sender = makeAddr("sender");
    address internal recipient = makeAddr("recipient");
    address internal charity = makeAddr("charity");

    uint256 internal keyA = 0xA11CE;
    address internal linkA;

    function setUp() public {
        sauce = new MockUSDC();
        mothership = new MockMothership(ERC20(address(sauce)));
        source = new SauceStakingSource(mothership);
        links = new YieldLinks(source, charity);
        source.setController(address(links));
        linkA = vm.addr(keyA);

        // The pool starts with existing stakers, like the live testnet pool.
        sauce.mint(address(this), 1_000 * ONE);
        sauce.approve(address(mothership), type(uint256).max);
        mothership.enter(1_000 * ONE);

        sauce.mint(sender, 500 * ONE);
        vm.prank(sender);
        sauce.approve(address(source), type(uint256).max);
    }

    function _sign(address to) internal view returns (bytes memory) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("YieldLinks"),
                keccak256("1"),
                block.chainid,
                address(links)
            )
        );
        bytes32 structHash = keccak256(abi.encode(links.CLAIM_TYPEHASH(), linkA, to));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(keyA, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _create(YieldLinks.YieldPolicy policy) internal {
        vm.prank(sender);
        links.createLink(linkA, address(sauce), 100 * ONE, uint64(block.timestamp + 7 days), policy);
    }

    function test_deposit_stakesIntoTheMothership() public {
        _create(YieldLinks.YieldPolicy.Recipient);

        assertEq(sauce.balanceOf(address(source)), 0);
        assertGt(mothership.xSauce() == address(0) ? 0 : ERC20(mothership.xSauce()).balanceOf(address(source)), 0);
        (uint256 value, uint256 principal) = links.claimable(linkA);
        assertApproxEqAbs(value, principal, 1e3);
    }

    function test_yield_flowsFromPoolRewardsToTheLink() public {
        _create(YieldLinks.YieldPolicy.Recipient);
        (uint256 before_,) = links.claimable(linkA);

        sauce.mint(address(mothership), 110 * ONE); // swap-fee rewards land in the pool: +10%
        (uint256 after_,) = links.claimable(linkA);

        assertGt(after_, before_ + 8 * ONE); // roughly +10 SAUCE on a 100 SAUCE link
    }

    function test_claim_paysPrincipalPlusStakingYield() public {
        _create(YieldLinks.YieldPolicy.Recipient);
        sauce.mint(address(mothership), 110 * ONE);

        links.claim(linkA, recipient, _sign(recipient));

        assertGt(sauce.balanceOf(recipient), 108 * ONE);
        assertLe(sauce.balanceOf(recipient), 111 * ONE);
    }

    function test_claim_senderPolicy_yieldReturnsToSender() public {
        _create(YieldLinks.YieldPolicy.Sender);
        sauce.mint(address(mothership), 110 * ONE);

        links.claim(linkA, recipient, _sign(recipient));

        assertApproxEqAbs(sauce.balanceOf(recipient), 100 * ONE, 1e3);
        assertGt(sauce.balanceOf(sender), 400 * ONE + 8 * ONE);
    }

    function test_refund_unwindsTheStake() public {
        _create(YieldLinks.YieldPolicy.Recipient);
        vm.warp(block.timestamp + 7 days);

        links.refund(linkA);

        assertApproxEqAbs(sauce.balanceOf(sender), 500 * ONE, 1e3);
    }

    function test_source_rejectsOtherTokens() public {
        MockUSDC other = new MockUSDC();
        vm.expectRevert(abi.encodeWithSelector(SauceStakingSource.UnsupportedToken.selector, address(other)));
        source.totalAssets(address(other));
    }

    function test_source_onlyControllerMovesFunds() public {
        vm.expectRevert(ControlledSource.NotController.selector);
        source.withdraw(address(sauce), 1, address(this));
    }
}
