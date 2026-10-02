// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ControlledSource } from "./ControlledSource.sol";
import { IMothership } from "../interfaces/IMothership.sol";
import { HtsLib } from "../libraries/HtsLib.sol";

/// Escrowed SAUCE is staked in SaucerSwap's Infinity Pool while a link is unclaimed.
/// Remove SaucerSwap and there is no yield and nowhere to put the funds, so the integration is load-bearing.
///
/// Value of the position = xSAUCE held x (SAUCE in the pool / xSAUCE supply), the standard bar ratio.
contract SauceStakingSource is ControlledSource {
    using SafeERC20 for IERC20;

    error UnsupportedToken(address token);
    error InsufficientAssets();

    /// Each unstake rounds its shares up, and two payouts from one link (recipient, then yield) can round up by one
    /// share more than the source holds. The later payee may then be a unit or two short; more than this reverts.
    uint256 public constant MAX_ROUNDING_SHORTFALL = 2;

    IMothership public immutable MOTHERSHIP;
    IERC20 public immutable SAUCE;
    IERC20 public immutable X_SAUCE;

    constructor(IMothership mothership) {
        MOTHERSHIP = mothership;
        SAUCE = IERC20(mothership.sauce());
        X_SAUCE = IERC20(mothership.xSauce());
    }

    /// Idle SAUCE plus the SAUCE value of staked xSAUCE.
    function totalAssets(address token) public view returns (uint256) {
        _requireSauce(token);
        uint256 supply = X_SAUCE.totalSupply();
        uint256 staked =
            supply == 0 ? 0 : (X_SAUCE.balanceOf(address(this)) * SAUCE.balanceOf(address(MOTHERSHIP))) / supply;
        return SAUCE.balanceOf(address(this)) + staked;
    }

    function deposit(address token, address from, uint256 amount) external onlyController {
        _requireSauce(token);
        HtsLib.associate(address(SAUCE));
        HtsLib.associate(address(X_SAUCE));
        SAUCE.safeTransferFrom(from, address(this), amount);
        SAUCE.forceApprove(address(MOTHERSHIP), amount);
        MOTHERSHIP.enter(amount);
    }

    function withdraw(address token, uint256 amount, address to) external onlyController {
        _requireSauce(token);
        uint256 idle = SAUCE.balanceOf(address(this));
        if (idle < amount) {
            uint256 shortfall = amount - idle;
            uint256 poolSauce = SAUCE.balanceOf(address(MOTHERSHIP));
            // Round shares up so the unstake covers the shortfall, but never beyond what we hold.
            uint256 shares = Math.mulDiv(shortfall, X_SAUCE.totalSupply(), poolSauce, Math.Rounding.Ceil);
            uint256 held = X_SAUCE.balanceOf(address(this));
            if (shares > held) shares = held;
            X_SAUCE.forceApprove(address(MOTHERSHIP), shares);
            MOTHERSHIP.leave(shares);
            uint256 balance = SAUCE.balanceOf(address(this));
            if (balance < amount) {
                if (amount - balance > MAX_ROUNDING_SHORTFALL) revert InsufficientAssets();
                amount = balance;
            }
        }
        _send(SAUCE, to, amount);
    }

    function _requireSauce(address token) internal view {
        if (token != address(SAUCE)) revert UnsupportedToken(token);
    }
}
