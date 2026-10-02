// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// SaucerSwap's Infinity Pool ("Mothership"): stake SAUCE for xSAUCE, a receipt token that
/// appreciates against SAUCE as swap-fee rewards accrue. Same shape as SushiBar.
/// Testnet 0.0.1418650 (0x15a59a), mainnet 0.0.1460199.
interface IMothership {
    function sauce() external view returns (address);
    function xSauce() external view returns (address);

    /// Pulls `amount` SAUCE from the caller (needs allowance) and mints xSAUCE.
    function enter(uint256 amount) external;

    /// Pulls `share` xSAUCE from the caller (needs allowance) and returns SAUCE.
    function leave(uint256 share) external;
}
