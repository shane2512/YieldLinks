# Agent instructions

Briefing for coding agents in this repo (Claude Code, Cursor, Codex). Claude Code loads it through `CLAUDE.md`.

## What this is

**YieldLinks**, a scaffold-hbar template: a sender stakes SAUCE in SaucerSwap's Infinity Pool and gets a link; the recipient claims with no wallet, no HBAR and no prior Hedera account. Read `README.md` first for the flow and `docs/THREAT_MODEL.md` before touching any contract. `docs/HEDERA_NOTES.md` lists platform gotchas that are easy to rediscover the slow way.

Stack: Foundry contracts (`packages/foundry`) and a Next.js App Router frontend (`packages/nextjs`, RainbowKit, Wagmi, Viem, DaisyUI). There is no Hardhat package. Use Yarn (`packageManager` in the root `package.json`).

## Commands

```bash
# Contracts (packages/foundry)
yarn foundry:test                     # forge test, 38 tests incl. stateful invariants
yarn foundry:lint                     # forge fmt --check + prettier on scripts-js
yarn foundry:chain                    # plain Anvil; deploys IdleSource (no yield)
yarn foundry:fork                     # Anvil forking testnet, chain id 296; deploys the SaucerSwap source
yarn foundry:deploy --network hedera_testnet
yarn foundry:demo                     # live testnet proof: create, claim to a new address, cancel

# Frontend (packages/nextjs)
yarn next:dev                         # http://localhost:3000
yarn next:lint                        # eslint . --max-warnings=0
yarn next:check-types
yarn next:build
```

If `forge` reports "No tests found" or "No contract bytecode" right after a successful build, run `forge clean` and rebuild (stale incremental cache).

## Layout

- `packages/foundry/contracts/YieldLinks.sol`: escrow, pooled shares, EIP-712 claims, refunds. Holds no tokens itself.
- `packages/foundry/contracts/interfaces/IYieldSource.sol`: the seam. A source is the **only** token holder.
- `packages/foundry/contracts/sources/`: `ControlledSource` (one-time controller binding, HIP-904 `_send`), `SauceStakingSource` (SaucerSwap), `IdleSource` (no yield).
- `packages/foundry/contracts/libraries/HtsLib.sol`: HTS association and airdrop; no-ops where `0x167` has no code.
- `packages/foundry/script/Deploy.s.sol`: picks the source by chain id, binds it, writes `deployments/<chainId>.json`.
- `packages/foundry/test/`: unit, fuzz, attack and HTS-delivery tests; mocks in `test/mocks/`.
- `packages/nextjs/app/api/claim/route.ts`: the gas-paying relayer.
- `packages/nextjs/components/yieldlinks/` and `utils/yieldlinks/`: the product UI and the key/URL/signature helpers.
- `packages/nextjs/contracts/deployedContracts.ts`: **generated** by the deploy script. Never edit it by hand; run a deploy instead.

## Invariants (do not break these)

1. **A link key is single use, forever.** Links are never deleted; only `status` changes. Deleting a link or reusing a key lets an old signature be replayed.
2. **Claims are bound to the recipient.** The EIP-712 payload is `Claim(linkKey, recipient)` in the `YieldLinks`/`1` domain with chain id and contract. Changing the typed data means changing `utils/yieldlinks/index.ts`, the contract's `CLAIM_TYPEHASH` and the tests together.
3. **`YieldLinks` never holds tokens.** All custody and payout goes through the `IYieldSource`. Value is priced from `totalAssets` before any withdrawal in `_settle`.
4. **Settle before you pay.** `_settle` burns shares and closes the link before any external call.
5. **No owner, no upgrade path, no keeper.** Refunds are permissionless after expiry. Do not add admin powers over escrow or a dependency on Hedera scheduling (see `docs/HEDERA_NOTES.md`, HSS bug).
6. **Never hardcode token decimals.** SAUCE is 6, but read it where you can.

## Secrets and links

- Never commit `.env`, `.env.local`, private keys or keystores. `RELAYER_PRIVATE_KEY` is server-only and must never get a `NEXT_PUBLIC_` prefix.
- A claim link's private key lives only in the URL **fragment** (`#k=...`), which browsers never send to a server. Do not log it, put it in a query string, or send it to an API route. The relayer receives a signature, never the key.

## Adding a yield source

1. Create `contracts/sources/MySource.sol` inheriting `ControlledSource`.
2. Implement `totalAssets`, `deposit` (pull from `from`, put to work) and `withdraw` (unwind, then `_send`). Associate any HTS token it holds with `HtsLib.associate`.
3. Round so a withdrawal never pays out more than `totalAssets` reports.
4. Add a mock venue under `test/mocks/` and tests mirroring `SauceStakingSource.t.sol`: deposit, yield flowing to the link, claim, refund, wrong token, non-controller.
5. Select it in `script/Deploy.s.sol`, deploy, and the frontend picks it up from `deployedContracts.ts`. If the token changes, update the `SAUCE()` read in `CreateLinkForm.tsx` and the `TOKEN_DECIMALS` in `utils/yieldlinks`.

## Hedera pitfalls (full detail in `docs/HEDERA_NOTES.md`)

- Send legacy transactions with the node's gas price.
- Take the nonce from the mirror node, not from Hashio, after any failed transaction.
- `SauceStakingSource.deposit` pulls from `from`, so the sender approves the **source** address, not `YieldLinks`.
- The SaucerSwap Mothership needs an allowance on `enter` (SAUCE) **and** on `leave` (xSAUCE).
- Use the mirror node's `/contracts/results/{hash}/actions` to trace a revert; Hashio gives no trace.

## Frontend conventions

- Contract hooks live in `packages/nextjs/hooks/scaffold-hbar`: `useScaffoldReadContract`, `useScaffoldWriteContract` (not the old `...ContractRead/Write` names), `useDeployedContractInfo`.
- Pass an explicit `gas` to writes that touch HTS or SaucerSwap; estimates are unreliable for precompile-heavy calls.
- DaisyUI classes over raw Tailwind where a component exists. Imports use the `~~` alias.
- Prefer `type` over `interface`. No `T` prefix on types. Comments say why, not what.

## Style

| Style | Use |
| --- | --- |
| `UpperCamelCase` | types, components, contracts |
| `lowerCamelCase` | variables, functions |
| `CONSTANT_CASE` | constants and immutables |
| `snake_case` | Foundry script files |

Commits go through the husky pre-commit hook (`yarn lint-staged`): ESLint and type-check for staged frontend files, and `foundry:lint` plus `foundry:test` when Solidity or scripts are staged. Never bypass it with `--no-verify`. Run `forge fmt` and `yarn next:lint` before finishing. A change to contract behavior ships with a test that fails without it.
