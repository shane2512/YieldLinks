// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Where escrowed tokens sit while a link is unclaimed.
/// A source is the only holder of tokens and is controlled by exactly one YieldLinks contract.
/// Ship a new lending protocol by implementing this interface; YieldLinks never changes.
interface IYieldSource {
    /// Underlying-token value currently held for the controller, including accrued yield.
    function totalAssets(address token) external view returns (uint256);

    /// Pulls `amount` of `token` from `from` (who must have approved this source) and puts it to work.
    function deposit(address token, address from, uint256 amount) external;

    /// Sends `amount` of `token` to `to`, unwinding from the yield venue if needed.
    function withdraw(address token, uint256 amount, address to) external;
}
