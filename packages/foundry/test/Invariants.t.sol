// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { YieldLinks } from "../contracts/YieldLinks.sol";
import { IdleSource } from "../contracts/sources/IdleSource.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";

/// Drives random, interleaved sequences of creates, yield, claims, cancels and expiries so the
/// invariants below are checked after every step, not just on hand-picked scenarios.
contract LinksHandler is Test {
    uint256 internal constant KEY_COUNT = 12;
    uint256 internal constant ONE = 1e6;

    YieldLinks public links;
    MockUSDC public usdc;
    IdleSource public source;

    address public sender = address(0x5E1D);
    address public recipient = address(0xBEEF);
    address public charity = address(0xC4A2);

    address[] public linkKeys;
    mapping(address => uint256) internal keyOf;

    uint256 public yieldMinted;
    uint256 public deposited;

    // Proof the campaign exercised every path, not just early returns.
    uint256 public creates;
    uint256 public claims;
    uint256 public refunds;

    constructor(YieldLinks links_, MockUSDC usdc_, IdleSource source_) {
        links = links_;
        usdc = usdc_;
        source = source_;
        for (uint256 i = 0; i < KEY_COUNT; i++) {
            uint256 pk = i + 1;
            address key = vm.addr(pk);
            linkKeys.push(key);
            keyOf[key] = pk;
        }
        usdc.mint(sender, type(uint128).max);
        vm.deal(sender, 1_000_000 ether);
        vm.prank(sender);
        usdc.approve(address(source), type(uint256).max);
    }

    function linkCount() external pure returns (uint256) {
        return KEY_COUNT;
    }

    function statusOf(address key) public view returns (YieldLinks.Status status) {
        (,, status,,,,,,) = links.links(key);
    }

    function create(uint256 index, uint256 amount, uint8 policy, uint256 fee) external {
        address key = linkKeys[index % KEY_COUNT];
        if (statusOf(key) != YieldLinks.Status.None) return;
        amount = bound(amount, 1, 1_000_000 * ONE);
        fee = bound(fee, 0, 2 ether);
        vm.prank(sender);
        try links.createLink{ value: fee }(
            key, address(usdc), amount, uint64(block.timestamp + 7 days), YieldLinks.YieldPolicy(policy % 3)
        ) {
            deposited += amount + links.ROUNDING_DUST();
            creates++;
        } catch { }
    }

    function accrue(uint256 amount) external {
        amount = bound(amount, 0, 100_000 * ONE);
        usdc.mint(address(source), amount);
        yieldMinted += amount;
    }

    function claim(uint256 index) external {
        address key = linkKeys[index % KEY_COUNT];
        if (statusOf(key) != YieldLinks.Status.Open) return;
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
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(keyOf[key], keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        try links.claim(key, recipient, abi.encodePacked(r, s, v)) {
            claims++;
        } catch { }
    }

    function cancel(uint256 index) external {
        address key = linkKeys[index % KEY_COUNT];
        vm.prank(sender);
        try links.refund(key) {
            refunds++;
        } catch { }
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 3 days));
    }

    /// Anyone can refund, but only once the link has expired.
    function refundAsStranger(uint256 index) external {
        vm.prank(address(0xBAD));
        try links.refund(linkKeys[index % KEY_COUNT]) {
            refunds++;
        } catch { }
    }
}

contract InvariantsTest is StdInvariant, Test {
    YieldLinks internal links;
    MockUSDC internal usdc;
    IdleSource internal source;
    LinksHandler internal handler;

    function setUp() public {
        usdc = new MockUSDC();
        source = new IdleSource();
        links = new YieldLinks(source, address(0xC4A2));
        source.setController(address(links));
        handler = new LinksHandler(links, usdc, source);

        targetContract(address(handler));
    }

    /// The source can always pay every open link in full, whatever the yield and ordering.
    function invariant_poolIsSolvent() public view {
        uint256 owed;
        for (uint256 i = 0; i < handler.linkCount(); i++) {
            (uint256 assets,) = links.claimable(handler.linkKeys(i));
            owed += assets;
        }
        assertLe(owed, usdc.balanceOf(address(source)));
    }

    /// Pool shares always equal the shares held by links; closed links hold none.
    function invariant_sharesMatchLinks() public view {
        uint256 sum;
        for (uint256 i = 0; i < handler.linkCount(); i++) {
            (,, YieldLinks.Status status,,,,, uint128 shares,) = links.links(handler.linkKeys(i));
            if (status != YieldLinks.Status.Open) assertEq(shares, 0);
            sum += shares;
        }
        assertEq(links.totalShares(address(usdc)), sum);
    }

    /// Every unit of native coin the contract holds is either a prepaid fee on an open link or a credited fee waiting
    /// for its sender: nothing is stuck, nothing is owed twice. (The handler cannot receive the coin, so claim fees take
    /// the credit path; cancels and stranger refunds pay the sender directly.)
    function invariant_feesAreAccountedFor() public view {
        uint256 owed = links.pendingFees(handler.sender());
        for (uint256 i = 0; i < handler.linkCount(); i++) {
            (,,,,,,,, uint128 fee) = links.links(handler.linkKeys(i));
            owed += fee;
        }
        assertEq(address(links).balance, owed);
    }

    /// Nothing is created from thin air: tokens in the source plus tokens paid out equal what went in.
    function invariant_valueIsConserved() public view {
        uint256 held = usdc.balanceOf(address(source));
        uint256 refunded = usdc.balanceOf(handler.sender()) + handler.deposited() - type(uint128).max;
        uint256 paid = usdc.balanceOf(handler.recipient()) + usdc.balanceOf(handler.charity()) + refunded;
        assertEq(held + paid, handler.deposited() + handler.yieldMinted());
    }

    /// Fuzz campaigns only prove something if they reach every path. Drive the handler through a seeded
    /// sequence, confirm creates, claims and both kinds of refund really happen, and re-check the invariants.
    function test_campaignExercisesEveryPath() public {
        uint256 strangerRefunds;
        for (uint256 i = 0; i < 400; i++) {
            uint256 r = uint256(keccak256(abi.encode("campaign", i)));
            uint256 action = r % 6;
            uint256 arg = r >> 8;
            if (action == 0) {
                handler.create(arg, arg >> 16, uint8(arg >> 40), arg >> 48);
            } else if (action == 1) {
                handler.accrue(arg);
            } else if (action == 2) {
                handler.claim(arg);
            } else if (action == 3) {
                handler.cancel(arg);
            } else if (action == 4) {
                handler.warp(arg);
            } else {
                uint256 before = handler.refunds();
                handler.refundAsStranger(arg);
                if (handler.refunds() > before) strangerRefunds++;
            }
            invariant_poolIsSolvent();
            invariant_sharesMatchLinks();
            invariant_valueIsConserved();
            invariant_feesAreAccountedFor();
        }
        assertGt(handler.creates(), 4, "too few creates");
        assertGt(handler.claims(), 0, "no claims");
        assertGt(handler.refunds(), 0, "no refunds");
        assertGt(strangerRefunds, 0, "no post-expiry refunds by a stranger");
    }
}
