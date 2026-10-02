// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IYieldSource } from "../interfaces/IYieldSource.sol";
import { HtsLib } from "../libraries/HtsLib.sol";

/// Shared plumbing for sources: bound once to a single controller (the YieldLinks contract),
/// so nobody else can move escrowed funds, and paying out through HIP-904 on Hedera.
abstract contract ControlledSource is IYieldSource {
    using SafeERC20 for IERC20;

    error NotController();
    error NotDeployer();
    error ControllerAlreadySet();
    error HbarTransferFailed();

    address public immutable DEPLOYER;
    address public controller;

    constructor() {
        DEPLOYER = msg.sender;
    }

    /// Accepts HBAR as a fee reserve. Delivering to a brand-new recipient incurs account-creation and
    /// association fees (about 0.5 HBAR). On testnet the transaction payer covered them in one run and this
    /// contract's balance in another, so keep a few HBAR here as a safety margin.
    receive() external payable { }

    modifier onlyController() {
        _checkController();
        _;
    }

    /// One-time binding to the YieldLinks contract. Deployer-only.
    function setController(address newController) external {
        if (msg.sender != DEPLOYER) revert NotDeployer();
        if (controller != address(0)) revert ControllerAlreadySet();
        controller = newController;
    }

    /// Returns unused fee-reserve HBAR. Deployer-only, and it cannot touch escrowed tokens.
    function withdrawHbar(address payable to, uint256 amount) external {
        if (msg.sender != DEPLOYER) revert NotDeployer();
        (bool ok,) = to.call{ value: amount }("");
        if (!ok) revert HbarTransferFailed();
    }

    function _checkController() internal view {
        if (msg.sender != controller) revert NotController();
    }

    /// HIP-904 airdrop on Hedera (no recipient setup needed); plain ERC-20 transfer elsewhere.
    function _send(IERC20 token, address to, uint256 amount) internal {
        if (HtsLib.isHedera()) HtsLib.airdrop(address(token), to, amount);
        else token.safeTransfer(to, amount);
    }
}
