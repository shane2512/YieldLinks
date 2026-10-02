# Threat model

YieldLinks holds other people's tokens, so this page says what can go wrong, what stops it, and where the test is. **The contracts have not been audited.**

## The one idea to hold

A gift link is **bearer value**. The private key in the URL fragment is the only thing that proves you may claim, so whoever has the link can claim it to any address. Everything below is about limiting what an attacker who does *not* have the link can do, and what happens when a link leaks.

## Assets and trust

| Party | Trusted to | Cannot |
| --- | --- | --- |
| Sender | Create and cancel their own links | Touch other links, or take a claimed link back |
| Link holder | Claim once, before expiry, to an address of their choosing | Claim after expiry, claim twice, or touch other links |
| Relayer | Pay gas for `claim` | Move funds, call anything except `claim`, or change the recipient (the signature fixes it) |
| Deployer | Bind the source to `YieldLinks` once; withdraw unused HBAR from the source | Move escrowed tokens, change the controller, or upgrade anything. There are no owner or upgrade functions. |
| Anyone | Trigger a refund after expiry | Send the refund anywhere but the sender |

## Threats

| # | Threat | Impact | What stops it | Evidence |
| --- | --- | --- | --- | --- |
| 1 | **Link leaks** (shared in a chat, shoulder-surfed, logged) | The holder can claim to their own address | Short expiry, sender can cancel at any time, UI warns to share like cash. Not preventable in this design. | `test_refund_senderCanCancelBeforeExpiry` |
| 2 | **Mempool front-running** a claim | An observer swaps in their own recipient | The signature covers `(linkKey, recipient)` in an EIP-712 domain, so a different recipient fails signature recovery | `test_claim_frontRunnerCannotRedirectFunds` |
| 3 | **Replay of a spent claim** | Pays the same recipient twice | Status moves to `Claimed` and shares are burned | `test_claim_cannotBeReplayed` |
| 4 | **Replay against a reused key** | An old signature drains a new link that reuses the key | Links are never deleted and a key can be used once, ever | `test_createLink_keyCanNeverBeReused` |
| 5 | **Cross-chain or cross-contract replay** | A signature from testnet works on mainnet or another deployment | The EIP-712 domain binds chain id and `verifyingContract` | `_hashTypedDataV4` in `claim` |
| 6 | **Wrong signer** | Anyone claims | `ECDSA.recover` must equal `linkKey` | `test_claim_revertsOnWrongSigner` |
| 7 | **First-depositor inflation** | A tiny first deposit plus a donation skews the share price and steals from later users | Virtual shares and assets (`VIRTUAL = 1000`) | `test_firstDepositorInflation_costsAttackerMoreThanVictimLoses` |
| 8 | **Insolvency from rounding** | The pool owes more than it holds | Share and asset maths round against the user; payouts never exceed the pool | `testFuzz_poolStaysSolvent` (257 runs) |
| 9 | **Claim after expiry** | A stale link pays out | `claim` reverts after `expiry`; refund takes over | `test_claim_revertsAfterExpiry` |
| 10 | **Stranger cancels early** | Someone refunds your link before it expires | Only the sender can refund before expiry | `test_refund_strangerCannotCancelBeforeExpiry` |
| 11 | **Source drained by an outsider** | Tokens leave the staking position | Source functions are `onlyController`, and the controller is set once | `test_source_isBoundToOneController`, `test_source_onlyControllerMovesFunds` |
| 12 | **Relayer drained** | Attacker burns the relayer's HBAR with junk claims | The route simulates first (bad claims cost nothing), calls only `claim` on the known contract, caps gas, and rate limits 10 requests a minute per IP | `app/api/claim/route.ts` |
| 13 | **Relayer key stolen** | Loss of the relayer's HBAR | The key has no authority over escrow. Use a dedicated, lightly funded account. | design |
| 14 | **Reentrancy** | Callback during a token transfer | `nonReentrant` on every state-changing entry point; state is settled before payout | `YieldLinks.sol` |
| 15 | **Payout fails for a new recipient** | A claim reverts and the link looks stuck | HIP-904 delivers to unassociated and non-existent accounts; failures surface the Hedera response code, and the sender can still cancel or wait for expiry | `test_claim_revertsWithTheHederaCodeWhenTheAirdropIsRejected` |

### Added with generated wallets

| # | Threat | Impact | What stops it | Evidence |
| --- | --- | --- | --- | --- |
| 16 | **Using `/api/create-account` to create accounts in bulk** | Anyone makes the relayer pay about 0.58 HBAR per account | The request must carry a signature by an **open link's key** over the new public key (EIP-712, bound to chain, contract and public key), and the link must be open and unexpired on-chain. One link gets one account: retries return the same one. Requests are rate limited per IP. | `account-creation proof` tests in `utils/yieldlinks/ed25519.test.ts` |
| 17 | **A signed account request replayed for a different key** | An attacker reuses an observed signature to create an account they control | The signature covers the public key, so a different key recovers to a different signer | `is bound to the public key` test |
| 19 | **A link that did not prepay the network fee is claimed through the relayer** | The relayer spends HBAR on a link that cannot reimburse it | `claim` and `/api/create-account` read the link's fee and refuse below `MIN_PREPAID_FEE_TINYBAR` (HTTP 402 `FeeNotPrepaid`) before spending anything | `PrepaidFeeTest`, live refusal on testnet |
| 20 | **The fee payout reverts and blocks a claim or refund** | A contract recipient without `receive` traps funds | Payout is a low-level call; on failure the fee is credited to `pendingFees` and withdrawn with `withdrawPendingFees` | `NoReceiveSender`, `NoReceiveSubmitter` tests |
| 21 | **Rounding leaves the recipient short of the gift** | Recipient gets less than the amount sent | 10-unit rounding reserve taken from the sender, link value capped at `totalAssets`, bounded shortfall in the source | fuzz test `RecipientReceivesAtLeastTheAmount`, 25,000 runs |
| 18 | **The claim races the new account's visibility** | A claim reverts with `INVALID_ALIAS_KEY` | The route waits for the account to be visible and retries that one error | `docs/HEDERA_NOTES.md` |

## Known gaps

- **No audit**, and the fuzz and unit tests cover the contracts, not the relayer route or the React code.
- **The pool can lose value.** `SauceStakingSource` is only as safe as SaucerSwap's Infinity Pool. If the pool were drained, links would be worth less than their principal and claims would pay what is there.
- **Yield tokens are volatile.** SAUCE moves against the dollar; a gift's fiat value is not protected.
- **Creating accounts costs the relayer HBAR.** Each claim to a generated wallet costs about 0.58 HBAR for the account on top of the claim. A sender can create many cheap links and claim each to a fresh generated wallet, so the relayer's cost per claim exceeds the sender's. The one-account-per-link record is in memory and resets on restart. Production needs a funding budget, shared rate limits and persistent state.
- **The relayer is a single process.** Its rate limit is in memory and resets on restart, and sends are serialized through one nonce. Production needs a queue and shared limits.
- **In-browser wallet generation** shows a private key to the user once. A recipient who loses it loses the gift. Use passkeys or an embedded wallet in production.
- **HBAR sent to the source** is a fee reserve. Only the deployer can withdraw it (`withdrawHbar`), and a lost deployer key strands it. It cannot reach escrowed tokens either way.
- **Link storage in `localStorage`.** The sender's browser keeps the full URL, secret included, so the sender can re-share it. Anyone with access to that browser profile can read it.

## Reporting

Open an issue for anything non-sensitive. For a vulnerability, contact the repository owner privately before disclosing.
