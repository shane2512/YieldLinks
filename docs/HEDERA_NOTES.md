# Hedera notes

Platform behavior found while building this template, each verified against Hedera testnet on 1 to 2 October 2026. Read this before you change the contracts or the relayer; most of these cost an hour the first time.

## Transactions and tooling

**Nonce lag (`WRONG_NONCE`).** After a failed transaction, Hashio's `eth_getTransactionCount` can fall behind the account's real nonce, so the next send is rejected. The mirror node's `ethereum_nonce` (`GET /api/v1/accounts/{address}`) is authoritative. The relayer and `demo.js` read it and pass it explicitly. `forge script --slow` avoids the issue for multi-contract deploys by confirming each transaction first.

**Send legacy transactions.** Hedera's minimum gas price is far above what ethers v5's EIP-1559 guess sometimes returns (`Gas price '3000000164' is below configured minimum gas price '840000000000'`). Use `type: 0` with the node's `getGasPrice()`. Foundry needs `--legacy`.

**Hashio refuses to simulate from an unfunded account** (`INSUFFICIENT_PAYER_BALANCE`), even for a view-style `eth_call` with a `from`. Fund the account you simulate from.

**No traces from Hashio, but the mirror node has them.** To see why a call reverted deep in a contract, fetch `GET /api/v1/contracts/results/{txHash}/actions` and read the call stack and revert reasons. This is how the Bonzo failure below was found.

**Reads can be a few seconds stale.** Right after a transaction, a balance read through Hashio may still show the old value. The UI refetches shortly after a refund for this reason.

**`forge script` needs a large simulation gas limit** for a two-contract deploy (`--gas-limit 14000000`). `forge create` swallows later flags if `--constructor-args` is not last.

## HTS

**HIP-904 airdrop works from a contract.** `airdropTokens` on the HTS system contract (`0x167`) called from `SauceStakingSource` with the source as sender delivered to an EVM address Hedera had never seen: the mirror node then showed a new account with `max_automatic_token_associations: -1`, the token balance already credited, and no pending airdrop. The ABI is `airdropTokens((address,(address,int64,bool)[],(address,address,int64,bool)[])[])`.

**Auto-association on first receipt.** An account created by receiving HBAR gets unlimited automatic associations, so an ERC-20 `transfer` of an HTS token to it succeeds without the recipient associating first. An account you did not create this way (for example one made in a portal with a fixed limit) must associate before it can hold a token.

**Association is a precompile call.** `associateToken(account, token)` at `0x167` works from an EOA (sign it like any contract call) and from a contract for itself. Association returns code `22` on success and `194` if already associated; `HtsLib.associate` accepts both.

**The ERC-20 facade just works** for `approve`, `transferFrom` and `balanceOf` on HTS tokens, including from contracts. Decimals are whatever the token has (6 for SAUCE and USDC); never hardcode 18.

**Who pays the account-creation fee depends on the network version.** The mirror node shows it (`GET /api/v1/transactions/{transactionId}` returns the parent and every child record):

| Run | Records | Who paid |
| --- | --- | --- |
| 1 Oct probe contract (`0x153719dd…`) | `CRYPTOCREATEACCOUNT` (fee 0), then a **`TOKENAIRDROP`** child with fee 0.482 HBAR | The **sending contract**, from its own balance |
| 2 Oct final claim (`0xc753f953…`) | `CRYPTOCREATEACCOUNT` and `CRYPTOTRANSFER` (fee 0 each), no `TOKENAIRDROP` record | The **transaction payer** (the relayer), inside the single 1.281 HBAR fee; the source's 2 HBAR reserve was untouched |

Do not rely on either. Keep a small HBAR reserve on the source (the deployer can reclaim it with `withdrawHbar`) and re-check this on the network you deploy to.

**Measured fees** (testnet, about $0.105 per HBAR, 2 Oct 2026): claim 1.28 HBAR, create 0.76 HBAR, cancel 0.71 HBAR.

## Hollow accounts and wallet apps

An address that has only ever *received* something becomes a **hollow account**: it exists, it can hold HBAR and tokens, but the mirror node shows `key: null`. Its public key is recorded only after it signs a transaction. Verified on testnet (account `0.0.10828572`):

| State | `GET /accounts/{evmAddress}` | `GET /accounts?account.publickey={compressed key}` |
| --- | --- | --- |
| Funded, never signed | `key: null` | **no account found** |
| After one signed 0-value self-transaction | `key: { _type: ECDSA_SECP256K1, ... }` | account found |

Wallet apps such as HashPack look accounts up by public key, so importing the private key of a hollow account reports "no account found". Activating the account (fund it a little, then sign one transaction with its key) fixes that. The signing transaction costs about 0.017 HBAR and needs at least a few hundredths of an HBAR in the account, which is why `/api/activate` sends 0.1 HBAR first. The compressed public key for the lookup is 33 bytes (`ethers.utils.SigningKey(key).compressedPublicKey`).

Two related gotchas: funding an address from a plain transfer needs more gas than 21,000 because it creates the account (the funding call with a 100,000 gas limit failed; 1,000,000 worked), and mirror-node log searches by topic require a bounded `timestamp=gte:..&timestamp=lte:..` range of at most about 7 days or they return an error.

## SaucerSwap

| Thing | Value |
| --- | --- |
| Infinity Pool ("Mothership") testnet | `0.0.1418650` = `0x000000000000000000000000000000000015A59A` |
| Infinity Pool mainnet | `0.0.1460199` = `0x00000000000000000000000000000000001647E7` |
| SAUCE testnet / mainnet | `0.0.1183558` (`0x…120f46`) / `0.0.731861` (`0x…0b2ad5`) |
| xSAUCE testnet / mainnet | `0.0.1418651` (`0x…15a59b`) / `0.0.1460200` (`0x…1647e8`) |
| V1 router testnet | `0.0.19264` = `0x0000000000000000000000000000000000004b40` |
| WHBAR **token** testnet | `0.0.15058` = `0x…3aD2`. Use this in swap paths. The WHBAR *helper* `0.0.15057` (`0x…3aD1`) reverts in `getAmountsOut`. |

- `enter(amount)` pulls SAUCE with `transferFrom`, so approve the Mothership first.
- **`leave(share)` also needs an allowance**, this time of xSAUCE to the Mothership. Without it the call reverts with no useful message.
- A round trip loses 1 base unit to rounding. The testnet pool has accrued about 0.3% (1 xSAUCE worth 1.003 SAUCE).
- `swapExactETHForTokens` takes `msg.value` in weibar through JSON-RPC (`--value 20ether` is 20 HBAR).

## Bonzo Finance (investigated, not used)

Bonzo was the first-choice yield venue because lending is a named integration. It is not usable right now:

- **Testnet.** The USDC and SAUCE reserves are active and not frozen, and the pool is an Aave v2 fork (`deposit` and `withdraw` exist, `supply` does not). Every `deposit` reverts with `CALLER_NOT_AUTHORIZED`. The mirror-node call trace shows the token transfer into the aToken succeeding, then the aToken's `mint` calling the rewards controller's `handleAction` (`0x31873e2e`) on `0.0.4998053`, which reverts. The controller does not authorize the aTokens. Reproduced on two reserves. The WETH gateway's `depositETH` reverts immediately.
- **Mainnet.** `paused()` returns `true` on the pool `0x236897c518996163E7b313aD21D1C9fCC7BA1afc`, and the USDC reserve's current liquidity rate is about 0.009%.

If Bonzo's testnet is fixed, a `BonzoSource implements IYieldSource` is a small addition: `deposit` and `withdraw` against the pool, and `totalAssets` as the aToken balance.

## Testing without Hedera

On plain Anvil and in `forge test` there is no HTS at `0x167`. `HtsLib` treats that as "not Hedera": association is skipped and payouts fall back to an ERC-20 transfer, so the same contracts run against mocks. The HIP-904 path is tested by etching a mock HTS at `0x167` (`test/HtsDelivery.t.sol`). Fork tests against testnet use `yarn foundry:test:testnet`.

## Windows

Nothing in this template needs `make`: tests, lint, deploy, `yarn foundry:chain` and `yarn foundry:fork` are plain Node and Foundry commands. If `forge test` reports "No tests found" or `forge script` reports "No contract bytecode" right after a successful build, the incremental cache is out of sync: run `forge clean` and build again.
