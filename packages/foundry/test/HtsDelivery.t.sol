// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { IHts, HtsLib } from "../contracts/libraries/HtsLib.sol";
import { YieldLinks } from "../contracts/YieldLinks.sol";
import { IdleSource } from "../contracts/sources/IdleSource.sol";
import { ControlledSource } from "../contracts/sources/ControlledSource.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";

/// Minimal HTS system contract: records airdrops and returns a configurable response code.
contract MockHts {
    int64 public failCode;
    address public lastToken;
    address public lastFrom;
    address public lastTo;
    int64 public lastAmount;
    uint256 public airdropCalls;

    function setFailCode(int64 code) external {
        failCode = code;
    }

    function associateToken(address, address) external pure returns (int64) {
        return 22;
    }

    function airdropTokens(IHts.TokenTransferList[] memory lists) external returns (int64) {
        if (failCode != 0) return failCode;
        lastToken = lists[0].token;
        lastFrom = lists[0].transfers[0].accountID;
        lastTo = lists[0].transfers[1].accountID;
        lastAmount = lists[0].transfers[1].amount;
        airdropCalls++;
        return 22;
    }
}

/// On Hedera, payouts go through HIP-904 so a recipient with no account or association still receives.
contract HtsDeliveryTest is Test {
    address internal constant HTS = 0x0000000000000000000000000000000000000167;
    uint256 internal constant ONE = 1e6;

    YieldLinks internal links;
    IdleSource internal source;
    MockUSDC internal usdc;

    address internal sender = makeAddr("sender");
    address internal recipient = makeAddr("recipient");
    uint256 internal keyA = 0xA11CE;
    address internal linkA;

    function setUp() public {
        vm.etch(HTS, address(new MockHts()).code);

        usdc = new MockUSDC();
        source = new IdleSource();
        links = new YieldLinks(source, address(0));
        source.setController(address(links));
        linkA = vm.addr(keyA);

        usdc.mint(sender, 100 * ONE);
        vm.prank(sender);
        usdc.approve(address(source), type(uint256).max);
        vm.prank(sender);
        links.createLink(
            linkA, address(usdc), 10 * ONE, uint64(block.timestamp + 1 days), YieldLinks.YieldPolicy.Recipient
        );
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

    function test_claim_deliversThroughHip904FromTheSource() public {
        links.claim(linkA, recipient, _sign(recipient));

        MockHts hts = MockHts(HTS);
        assertEq(hts.airdropCalls(), 1);
        assertEq(hts.lastToken(), address(usdc));
        assertEq(hts.lastFrom(), address(source));
        assertEq(hts.lastTo(), recipient);
        assertEq(hts.lastAmount(), 10_000_010); // 10 tokens at 6 decimals plus the 10-unit rounding reserve
    }

    function test_claim_revertsWithTheHederaCodeWhenTheAirdropIsRejected() public {
        MockHts(HTS).setFailCode(232); // e.g. payer cannot cover the account-creation fee
        bytes memory sig = _sign(recipient);

        vm.expectRevert(abi.encodeWithSelector(HtsLib.AirdropFailed.selector, int64(232)));
        links.claim(linkA, recipient, sig);
    }

    function test_refund_alsoDeliversThroughHip904() public {
        vm.prank(sender);
        links.refund(linkA);

        assertEq(MockHts(HTS).lastTo(), sender);
    }

    function test_source_acceptsHbarForCreationFees() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(source).call{ value: 1 ether }("");
        assertTrue(ok);
        assertEq(address(source).balance, 1 ether);
    }

    function test_source_deployerCanReclaimUnusedHbar() public {
        vm.deal(address(source), 1 ether);
        address payable dest = payable(makeAddr("dest"));

        source.withdrawHbar(dest, 1 ether);

        assertEq(dest.balance, 1 ether);
        assertEq(address(source).balance, 0);
    }

    function test_source_strangerCannotWithdrawHbar() public {
        vm.deal(address(source), 1 ether);

        vm.prank(sender);
        vm.expectRevert(ControlledSource.NotDeployer.selector);
        source.withdrawHbar(payable(sender), 1 ether);
    }
}
