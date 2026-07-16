// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @title MultiSend
/// @notice Send ERC-20 tokens to multiple recipients in a single transaction.
///         Caller must approve this contract first: token.approve(multiSend, totalAmount)
contract MultiSend {
    error LengthMismatch();
    error EmptyRecipients();
    error TooManyRecipients();
    error ZeroAmount();
    error ZeroAddress();
    error TransferFailed(address recipient, uint256 amount);

    uint256 public constant MAX_RECIPIENTS = 200;

    event MultiTransfer(
        address indexed token,
        address indexed sender,
        uint256 recipientCount,
        uint256 totalAmount
    );

    /// @notice Transfer `amounts[i]` of `token` to each `recipients[i]`.
    ///         All transfers are atomic — if any fails, the whole tx reverts.
    /// @param token     ERC-20 token address
    /// @param recipients Array of destination addresses
    /// @param amounts   Array of amounts (in token's smallest unit, e.g. 1 USDC = 1_000_000)
    function multiTransfer(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        uint256 len = recipients.length;
        if (len == 0)          revert EmptyRecipients();
        if (len > MAX_RECIPIENTS) revert TooManyRecipients();
        if (len != amounts.length) revert LengthMismatch();

        uint256 total = 0;
        for (uint256 i = 0; i < len; ) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0)             revert ZeroAmount();
            total += amounts[i];
            unchecked { ++i; }
        }

        // Single allowance check upfront — saves gas vs checking per transfer
        uint256 allowed = IERC20(token).allowance(msg.sender, address(this));
        require(allowed >= total, "MultiSend: insufficient allowance");

        for (uint256 i = 0; i < len; ) {
            bool ok = IERC20(token).transferFrom(msg.sender, recipients[i], amounts[i]);
            if (!ok) revert TransferFailed(recipients[i], amounts[i]);
            unchecked { ++i; }
        }

        emit MultiTransfer(token, msg.sender, len, total);
    }

    /// @notice Preview: compute total amount needed for a batch.
    ///         Call this off-chain before approving.
    function totalAmount(uint256[] calldata amounts) external pure returns (uint256 total) {
        for (uint256 i = 0; i < amounts.length; ) {
            total += amounts[i];
            unchecked { ++i; }
        }
    }
}
