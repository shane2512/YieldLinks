# Foundry package

Contracts, deploy script and tests for YieldLinks. The product overview is in the [root README](../../README.md); read [`docs/THREAT_MODEL.md`](../../docs/THREAT_MODEL.md) before changing a contract.

## Setup

Forge dependencies are git submodules under `lib/`. From the repo root:

```bash
git submodule update --init --recursive
```

## Contracts

| File | Role |
| --- | --- |
| `contracts/YieldLinks.sol` | Escrow against a throwaway key, pooled share accounting, EIP-712 claims, refunds. Holds no tokens. |
| `contracts/interfaces/IYieldSource.sol` | Where escrowed tokens sit and earn. Implement it to add a venue. |
| `contracts/sources/ControlledSource.sol` | One-time controller binding, HBAR reserve, HIP-904 payout. |
| `contracts/sources/SauceStakingSource.sol` | Stakes SAUCE in SaucerSwap's Infinity Pool. |
| `contracts/sources/IdleSource.sol` | No yield. Reference implementation and plain-Anvil fallback. |
| `contracts/libraries/HtsLib.sol` | HTS association and airdrop; no-ops where HTS does not exist. |

## Tests

```bash
yarn test                 # forge test: 34 tests on a plain EVM, no Hedera node needed
yarn test:testnet         # same suite against a testnet fork (needs --ffi and a mirror node)
```

The suite covers accounting and yield for all three yield policies, front-running, replay and key reuse, expiry and refunds, the first-depositor inflation attack, a solvency fuzz test, the staking source against a mock Infinity Pool, and HIP-904 delivery against a mock HTS etched at `0x167`.

## Deploy

```bash
yarn foundry:account:generate            # from the repo root: create a keystore funded on Hedera
yarn foundry:deploy --network hedera_testnet
```

The script chooses the source by chain id (`296` and `295` stake SAUCE, anything else uses `IdleSource`), binds it to `YieldLinks`, writes `deployments/<chainId>.json`, and regenerates `packages/nextjs/contracts/deployedContracts.ts`. The deployer address must be an account that exists on Hedera; fund it from the [Hedera Portal faucet](https://portal.hedera.com/faucet).

Optional environment: `CHARITY_ADDRESS` (defaults to the deployer) and `SOURCE_HBAR_RESERVE` (HBAR for account-creation fees, in wei-style units; the deployer can reclaim it with `withdrawHbar`).

## Live demo

```bash
yarn foundry:demo
```

Creates a link, claims it to an address Hedera has never seen, then creates and cancels a second link, printing a HashScan link for each transaction. Needs `DEPLOYER_PRIVATE_KEY` in `.env` and at least 4 testnet SAUCE.

## Local chains

- `yarn chain` runs plain Anvil. The deploy uses `IdleSource`, so the app works without yield.
- `yarn fork` runs Anvil forked from Hedera testnet with chain id 296, so the SaucerSwap source and HTS behave as on the network.

On Windows the deploy, chain and fork scripts need `make` (use WSL or Git Bash); tests and lint do not.
