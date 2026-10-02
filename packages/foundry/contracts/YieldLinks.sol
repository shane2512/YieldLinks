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
        /// Network fee prepaid by the sender in the chain's native coin, paid to whoever submits the claim.
        uint128 fee;
    }

    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(address linkKey,address recipient)");
    uint256 public constant VIRTUAL = 1e3;
    uint256 public constant MAX_DURATION = 365 days;

    /// Extra tokens taken from the sender on top of the gift. Share and pool arithmetic rounds down by a unit or two,
    /// and this reserve absorbs it, so the recipient always receives at least the amount the sender chose.
    uint256 public constant ROUNDING_DUST = 10;

    IYieldSource public immutable SOURCE;
    address public immutable CHARITY;

    mapping(address linkKey => Link) public links;
    mapping(address token => uint256) public totalShares;

    /// Fees that could not be sent to their recipient (for example a contract that rejects the native coin).
    /// Credited to the link's sender, who can withdraw them to any address.
    mapping(address sender => uint256) public pendingFees;

    event LinkCreated(
        address indexed linkKey,
        address indexed sender,
        address token,
        uint256 amount,
        uint64 expiry,
        YieldPolicy policy,
        uint256 fee
    );
    event LinkClaimed(
        address indexed linkKey, address indexed recipient, uint256 toRecipient, address yieldTo, uint256 yieldAmount
    );
    event LinkRefunded(address indexed linkKey, address indexed sender, uint256 amount);
    event FeePaid(address indexed linkKey, address indexed to, uint256 amount);
    event FeeWithdrawn(address indexed sender, address indexed to, uint256 amount);

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
    error NothingToWithdraw();
    error WithdrawFailed();

    constructor(IYieldSource source_, address charity_) EIP712("YieldLinks", "1") {
        SOURCE = source_;
        CHARITY = charity_;
    }

    /// Escrows `amount` of `token` against `linkKey`, plus `ROUNDING_DUST` more so the recipient never receives less
    /// than `amount` (the sender must have approved the source for `amount + ROUNDING_DUST`). Any native coin sent
    /// with the call is the sender's prepaid network fee: it pays whoever submits the claim, and returns to the sender
    /// if the link is cancelled or expires.
    /// @param linkKey Address of the throwaway key whose private half goes in the link. Single use, forever.
    function createLink(address linkKey, address token, uint256 amount, uint64 expiry, YieldPolicy policy)
        external
        payable
        nonReentrant
        returns (uint256 shares)
    {
        if (linkKey == address(0)) revert InvalidLinkKey();
        if (links[linkKey].status != Status.None) revert LinkExists();
        if (amount == 0) revert InvalidAmount();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_DURATION) revert InvalidExpiry();
        if (policy == YieldPolicy.Charity && CHARITY == address(0)) revert NoCharity();

        uint256 deposit = amount + ROUNDING_DUST;
        shares = (deposit * (totalShares[token] + VIRTUAL)) / (SOURCE.totalAssets(token) + VIRTUAL);
        if (shares == 0) revert InvalidAmount();

        SOURCE.deposit(token, msg.sender, deposit);
        totalShares[token] += shares;
        links[linkKey] = Link({
            sender: msg.sender,
            expiry: expiry,
            status: Status.Open,
            policy: policy,
            token: token,
            createdAt: uint64(block.timestamp),
            principal: SafeCast.toUint128(amount),
            shares: SafeCast.toUint128(shares),
            fee: SafeCast.toUint128(msg.value)
        });

        emit LinkCreated(linkKey, msg.sender, token, amount, expiry, policy, msg.value);
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

        address sender = link.sender;
        uint256 fee = _payout(linkKey, link, recipient);
        _payFee(linkKey, msg.sender, sender, fee);
    }

    /// Returns everything (principal plus yield) to the sender. The sender can cancel at any time;
    /// after expiry anyone can trigger it, so refunds never depend on a keeper or on Hedera scheduling.
    function refund(address linkKey) external nonReentrant {
        Link storage link = links[linkKey];
        if (link.status != Status.Open) revert LinkNotOpen();
        if (msg.sender != link.sender && block.timestamp < link.expiry) revert NotRefundable();

        address token = link.token;
        address sender = link.sender;
        (uint256 assets, uint256 fee) = _settle(link, Status.Refunded);
        SOURCE.withdraw(token, assets, sender);
        _payFee(linkKey, sender, sender, fee);

        emit LinkRefunded(linkKey, sender, assets);
    }

    /// Sends the caller's fees that could not be delivered earlier to `to`.
    function withdrawPendingFees(address payable to) external nonReentrant {
        uint256 amount = pendingFees[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingFees[msg.sender] = 0;
        (bool ok,) = to.call{ value: amount }("");
        if (!ok) revert WithdrawFailed();
        emit FeeWithdrawn(msg.sender, to, amount);
    }

    /// Current value of an open link and the principal it started with. Zero once closed.
    function claimable(address linkKey) external view returns (uint256 assets, uint256 principal) {
        Link storage link = links[linkKey];
        if (link.status != Status.Open) return (0, 0);
        return (_quote(link.token, link.shares), link.principal);
    }

    /// Closes the link and pays out, routing any yield per the link's policy. Returns the prepaid fee to hand over.
    function _payout(address linkKey, Link storage link, address recipient) private returns (uint256 fee) {
        Link memory snapshot = link;
        uint256 assets;
        (assets, fee) = _settle(link, Status.Claimed);

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

    /// A link's value, never more than the source actually holds. The virtual offsets can value a link a unit or two
    /// above the pool when the venue rounded a tiny deposit down; asking it for more than it has would revert the claim
    /// and the refund alike.
    function _quote(address token, uint256 shares) internal view returns (uint256) {
        uint256 available = SOURCE.totalAssets(token);
        uint256 value = (shares * (available + VIRTUAL)) / (totalShares[token] + VIRTUAL);
        return value > available ? available : value;
    }

    /// Prices the link's shares, burns them, takes its prepaid fee and closes the link. Valued before any withdrawal.
    function _settle(Link storage link, Status end) internal returns (uint256 assets, uint256 fee) {
        address token = link.token;
        uint256 shares = link.shares;
        assets = _quote(token, shares);
        fee = link.fee;
        totalShares[token] -= shares;
        link.shares = 0;
        link.fee = 0;
        link.status = end;
    }

    /// Pays `fee` to `to`. If `to` cannot receive it, it is credited to `sender` instead, so nothing gets stuck.
    function _payFee(address linkKey, address to, address sender, uint256 fee) private {
        if (fee == 0) return;
        (bool ok,) = payable(to).call{ value: fee }("");
        if (ok) {
            emit FeePaid(linkKey, to, fee);
        } else {
            pendingFees[sender] += fee;
        }
    }
}
