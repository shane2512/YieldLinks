// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// HTS system-contract entry points (0x167) used by this template.
interface IHts {
    struct AccountAmount {
        address accountID;
        int64 amount;
        bool isApproval;
    }

    struct NftTransfer {
        address senderAccountID;
        address receiverAccountID;
        int64 serialNumber;
        bool isApproval;
    }

    struct TokenTransferList {
        address token;
        AccountAmount[] transfers;
        NftTransfer[] nftTransfers;
    }

    function associateToken(address account, address token) external returns (int64 responseCode);

    /// HIP-904 frictionless airdrop. Delivers immediately to accounts that are associated or have free
    /// auto-association slots (including brand-new hollow accounts); otherwise leaves a pending airdrop.
    function airdropTokens(TokenTransferList[] memory tokenTransfers) external returns (int64 responseCode);
}

/// Small wrapper over the HTS system contract.
/// Calls degrade gracefully where 0x167 has no code (plain Anvil, unit tests), so the same contracts run
/// against mock ERC-20s locally and real HTS tokens on Hedera.
library HtsLib {
    address internal constant HTS = 0x0000000000000000000000000000000000000167;

    int64 internal constant SUCCESS = 22;
    int64 internal constant TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT = 194;

    error AssociationFailed(int64 responseCode);
    error AirdropFailed(int64 responseCode);

    function isHedera() internal view returns (bool) {
        return HTS.code.length != 0;
    }

    /// Associates the calling contract with `token` so it can hold it. Idempotent.
    function associate(address token) internal {
        if (!isHedera()) return;
        (bool ok, bytes memory ret) = HTS.call(abi.encodeCall(IHts.associateToken, (address(this), token)));
        if (!ok || ret.length < 32) revert AssociationFailed(-1);
        int64 code = abi.decode(ret, (int64));
        if (code != SUCCESS && code != TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT) revert AssociationFailed(code);
    }

    /// Sends `amount` of `token` from the calling contract to `to` via HIP-904. A recipient that has never
    /// touched Hedera needs no account and no association: the airdrop creates the account and delivers.
    /// Account creation and association cost about 0.5 HBAR; see ControlledSource for who pays.
    function airdrop(address token, address to, uint256 amount) internal {
        int64 value = SafeCast.toInt64(SafeCast.toInt256(amount));
        IHts.TokenTransferList[] memory lists = new IHts.TokenTransferList[](1);
        lists[0].token = token;
        lists[0].transfers = new IHts.AccountAmount[](2);
        lists[0].transfers[0] = IHts.AccountAmount(address(this), -value, false);
        lists[0].transfers[1] = IHts.AccountAmount(to, value, false);
        lists[0].nftTransfers = new IHts.NftTransfer[](0);

        (bool ok, bytes memory ret) = HTS.call(abi.encodeCall(IHts.airdropTokens, (lists)));
        if (!ok || ret.length < 32) revert AirdropFailed(-1);
        int64 code = abi.decode(ret, (int64));
        if (code != SUCCESS) revert AirdropFailed(code);
    }
}
