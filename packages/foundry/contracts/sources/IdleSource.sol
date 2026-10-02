// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ControlledSource } from "./ControlledSource.sol";
import { HtsLib } from "../libraries/HtsLib.sol";

/// Baseline source: tokens sit idle and earn nothing. It is the reference implementation of
/// `IYieldSource` and the starting point for adding a new venue.
contract IdleSource is ControlledSource {
    using SafeERC20 for IERC20;

    function totalAssets(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function deposit(address token, address from, uint256 amount) external onlyController {
        HtsLib.associate(token);
        IERC20(token).safeTransferFrom(from, address(this), amount);
    }

    function withdraw(address token, uint256 amount, address to) external onlyController {
        _send(IERC20(token), to, amount);
    }
}
