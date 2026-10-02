//SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { YieldLinks } from "../contracts/YieldLinks.sol";
import { IMothership } from "../contracts/interfaces/IMothership.sol";
import { IYieldSource } from "../contracts/interfaces/IYieldSource.sol";
import { IdleSource } from "../contracts/sources/IdleSource.sol";
import { ControlledSource } from "../contracts/sources/ControlledSource.sol";
import { SauceStakingSource } from "../contracts/sources/SauceStakingSource.sol";

/**
 * @notice Deploys the yield source, YieldLinks, and binds them together.
 * @dev Hedera testnet/mainnet (and a local fork, chain id 296) stake SAUCE in SaucerSwap's Infinity Pool.
 *      Any other chain, for example plain Anvil, uses `IdleSource` so the app still runs with no yield.
 *
 * Optional env: CHARITY_ADDRESS (receives yield for links created with the Charity policy, defaults to the
 * deployer) and SOURCE_HBAR_RESERVE (HBAR in wei-style units sent to the source as a fee reserve).
 *
 * Example: yarn foundry:deploy --network hedera_testnet
 */
contract DeployScript is ScaffoldETHDeploy {
    address internal constant MOTHERSHIP_TESTNET = 0x000000000000000000000000000000000015A59A; // 0.0.1418650
    address internal constant MOTHERSHIP_MAINNET = 0x00000000000000000000000000000000001647E7; // 0.0.1460199

    function run() external ScaffoldEthDeployerRunner {
        ControlledSource source = _deploySource();
        address charity = vm.envOr("CHARITY_ADDRESS", deployer);

        YieldLinks links = new YieldLinks(IYieldSource(address(source)), charity);
        source.setController(address(links));

        uint256 reserve = vm.envOr("SOURCE_HBAR_RESERVE", uint256(0));
        if (reserve > 0) {
            (bool ok,) = address(source).call{ value: reserve }("");
            require(ok, "reserve transfer failed");
        }

        deployments.push(Deployment({ name: "YieldLinks", addr: address(links) }));
        deployments.push(Deployment({ name: "YieldSource", addr: address(source) }));
    }

    function _deploySource() internal returns (ControlledSource) {
        if (block.chainid == 296) return new SauceStakingSource(IMothership(MOTHERSHIP_TESTNET));
        if (block.chainid == 295) return new SauceStakingSource(IMothership(MOTHERSHIP_MAINNET));
        return new IdleSource();
    }
}
