// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IYieldSource } from "./interfaces/IYieldSource.sol";

/// Gift links that grow. A sender escrows tokens against a throwaway public key (`linkKey`) whose
/// private half travels in a URL fragment. Whoever holds that key can sign a claim for any recipient,
/// and anyone (typically a gas-paying relayer) can submit it. While a link is unclaimed its tokens
/// sit in a yield source and earn.
///
/// Accounting is pooled shares per token, so yield accrues without per-link bookkeeping.
/// Virtual shares/assets blunt the first-depositor inflation attack.
contract YieldLinks is EIP712, ReentrancyGuard {
    /// Who receives the yield earned while a link is unclaimed.
    enum YieldPolicy {
        Recipient,
        Sender,
        Charity
    }

    enum Status {
        None,
        Open,
        Claimed,
        Refunded
    }

    struct Link {
        address sender;
        uint64 expiry;
        Status status;
        YieldPolicy policy;
        address token;
        uint64 createdAt;
        uint128 principal;
        uint128 shares;
    }

    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(address linkKey,address recipient)");
    uint256 public constant VIRTUAL = 1e3;
    uint256 public constant MAX_DURATION = 365 days;

    IYieldSource public immutable SOURCE;
    address public immutable CHARITY;

    mapping(address linkKey => Link) public links;
    mapping(address token => uint256) public totalShares;

    event LinkCreated(
        address indexed linkKey,
        address indexed sender,
        address token,
        uint256 amount,
        uint64 expiry,
        YieldPolicy policy
    );
    event LinkClaimed(
        address indexed linkKey, address indexed recipient, uint256 toRecipient, address yieldTo, uint256 yieldAmount
    );
    event LinkRefunded(address indexed linkKey, address indexed sender, uint256 amount);

    error InvalidLinkKey();
    error InvalidAmount();
    error InvalidExpiry();
    error InvalidRecipient();
    error InvalidSignature();
    error LinkExists();
    error LinkNotOpen();
    error LinkExpired();
    error NotRefundable();
    error NoCharity();

    constructor(IYieldSource source_, address charity_) EIP712("YieldLinks", "1") {
        SOURCE = source_;
        CHARITY = charity_;
    }

    /// Escrows `amount` of `token` (the sender must have approved the source) against `linkKey`.
    /// @param linkKey Address of the throwaway key whose private half goes in the link. Single use, forever.
    function createLink(address linkKey, address token, uint256 amount, uint64 expiry, YieldPolicy policy)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (linkKey == address(0)) revert InvalidLinkKey();
        if (links[linkKey].status != Status.None) revert LinkExists();
        if (amount == 0) revert InvalidAmount();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_DURATION) revert InvalidExpiry();
        if (policy == YieldPolicy.Charity && CHARITY == address(0)) revert NoCharity();

        shares = (amount * (totalShares[token] + VIRTUAL)) / (SOURCE.totalAssets(token) + VIRTUAL);
        if (shares == 0) revert InvalidAmount();

        SOURCE.deposit(token, msg.sender, amount);
        totalShares[token] += shares;
        links[linkKey] = Link({
            sender: msg.sender,
            expiry: expiry,
            status: Status.Open,
            policy: policy,
            token: token,
            createdAt: uint64(block.timestamp),
            principal: SafeCast.toUint128(amount),
            shares: SafeCast.toUint128(shares)
        });

        emit LinkCreated(linkKey, msg.sender, token, amount, expiry, policy);
    }

    /// Pays the link out to `recipient`. `signature` is the link key's EIP-712 signature over
    /// (linkKey, recipient), bound to this chain and contract, so a watcher who sees it in the
    /// mempool cannot redirect the funds.
    function claim(address linkKey, address recipient, bytes calldata signature) external nonReentrant {
        Link storage link = links[linkKey];
        if (link.status != Status.Open) revert LinkNotOpen();
        if (block.timestamp >= link.expiry) revert LinkExpired();
        if (recipient == address(0)) revert InvalidRecipient();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, linkKey, recipient)));
        if (ECDSA.recover(digest, signature) != linkKey) revert InvalidSignature();

        _payout(linkKey, link, recipient);
    }

    /// Returns everything (principal plus yield) to the sender. The sender can cancel at any time;
    /// after expiry anyone can trigger it, so refunds never depend on a keeper or on Hedera scheduling.
    function refund(address linkKey) external nonReentrant {
        Link storage link = links[linkKey];
        if (link.status != Status.Open) revert LinkNotOpen();
        if (msg.sender != link.sender && block.timestamp < link.expiry) revert NotRefundable();

        address token = link.token;
        address sender = link.sender;
        uint256 assets = _settle(link, Status.Refunded);
        SOURCE.withdraw(token, assets, sender);

        emit LinkRefunded(linkKey, sender, assets);
    }

    /// Current value of an open link and the principal it started with. Zero once closed.
    function claimable(address linkKey) external view returns (uint256 assets, uint256 principal) {
        Link storage link = links[linkKey];
        if (link.status != Status.Open) return (0, 0);
        return (_quote(link.token, link.shares), link.principal);
    }

    /// Closes the link and pays out, routing any yield per the link's policy.
    function _payout(address linkKey, Link storage link, address recipient) private {
        Link memory snapshot = link;
        uint256 assets = _settle(link, Status.Claimed);

        uint256 yieldAmount = assets > snapshot.principal ? assets - snapshot.principal : 0;
        address yieldTo;
        if (snapshot.policy == YieldPolicy.Sender) yieldTo = snapshot.sender;
        else if (snapshot.policy == YieldPolicy.Charity) yieldTo = CHARITY;
        if (yieldTo == address(0)) yieldAmount = 0;

        uint256 toRecipient = assets - yieldAmount;
        SOURCE.withdraw(snapshot.token, toRecipient, recipient);
        if (yieldAmount > 0) SOURCE.withdraw(snapshot.token, yieldAmount, yieldTo);

        emit LinkClaimed(linkKey, recipient, toRecipient, yieldTo, yieldAmount);
    }

    function _quote(address token, uint256 shares) internal view returns (uint256) {
        return (shares * (SOURCE.totalAssets(token) + VIRTUAL)) / (totalShares[token] + VIRTUAL);
    }

    /// Prices the link's shares, burns them and closes the link. Valued before any withdrawal.
    function _settle(Link storage link, Status end) internal returns (uint256 assets) {
        address token = link.token;
        uint256 shares = link.shares;
        assets = _quote(token, shares);
        totalShares[token] -= shares;
        link.shares = 0;
        link.status = end;
    }
}
