// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IMothership } from "../../contracts/interfaces/IMothership.sol";

/// 6-decimal receipt token minted and burned by the mock pool.
contract MockXSauce is ERC20 {
    address public immutable POOL;

    constructor() ERC20("Mock xSAUCE", "xSAUCE") {
        POOL = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == POOL, "pool only");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == POOL, "pool only");
        _burn(from, amount);
    }
}

/// SushiBar-shaped stand-in for SaucerSwap's Infinity Pool, matching the live testnet behaviour
/// (allowance-based pulls on both enter and leave).
contract MockMothership is IMothership {
    ERC20 public immutable SAUCE_TOKEN;
    MockXSauce public immutable X_SAUCE_TOKEN;

    constructor(ERC20 sauce_) {
        SAUCE_TOKEN = sauce_;
        X_SAUCE_TOKEN = new MockXSauce();
    }

    function sauce() external view returns (address) {
        return address(SAUCE_TOKEN);
    }

    function xSauce() external view returns (address) {
        return address(X_SAUCE_TOKEN);
    }

    function enter(uint256 amount) external {
        uint256 pool = SAUCE_TOKEN.balanceOf(address(this));
        uint256 supply = X_SAUCE_TOKEN.totalSupply();
        uint256 shares = (supply == 0 || pool == 0) ? amount : (amount * supply) / pool;
        require(SAUCE_TOKEN.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        X_SAUCE_TOKEN.mint(msg.sender, shares);
    }

    function leave(uint256 share) external {
        uint256 what = (share * SAUCE_TOKEN.balanceOf(address(this))) / X_SAUCE_TOKEN.totalSupply();
        require(X_SAUCE_TOKEN.transferFrom(msg.sender, address(this), share), "transferFrom failed");
        X_SAUCE_TOKEN.burn(address(this), share);
        require(SAUCE_TOKEN.transfer(msg.sender, what), "transfer failed");
    }
}
