// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {FHE, euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ConfidentialToken
/// @notice FHE-wrapped ERC20 where all balances are encrypted as euint64.
///         Users deposit plaintext ERC20 tokens and receive encrypted balances.
///         Transfers operate entirely on encrypted values — no amounts are ever revealed on-chain.
contract ConfidentialToken is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -- Errors --

    error ZeroAddress();
    error ZeroAmount();
    error NotApproved(address from, address spender);

    // -- Events --

    /// @dev Deposit amount is public because it comes from a plaintext ERC20 transfer
    event Deposited(address indexed account, uint64 amount);
    /// @dev NO amount in event — that would leak the encrypted transfer value
    event ConfidentialTransfer(address indexed from, address indexed to);

    // -- State --

    string public name = "Confidential USDC";
    string public symbol = "cUSDC";
    uint8 public decimals = 6;

    /// @notice Plaintext running total of wrapped tokens, for solvency tracking
    uint256 public totalWrapped;
    /// @notice The underlying ERC20 being wrapped (address(0) = native, unused for Wave 1)
    address public underlyingToken;

    mapping(address => euint64) private _balances;
    /// @notice Simple boolean approval for transferFrom (not encrypted amounts — Wave 1 simplicity)
    mapping(address => mapping(address => bool)) public approvals;

    // -- Constructor --

    /// @param _underlyingToken Address of the ERC20 to wrap (e.g. USDC)
    /// @param _owner Admin address for pause/unpause
    constructor(
        address _underlyingToken,
        address _owner
    ) Ownable(_owner) {
        if (_underlyingToken == address(0)) revert ZeroAddress();
        underlyingToken = _underlyingToken;
    }

    // -- Deposit / Withdraw --

    /// @notice Wrap plaintext ERC20 tokens into an encrypted balance.
    ///         Deposit amounts are visible on-chain (plaintext ERC20 transfer).
    ///         Privacy begins after wrapping — all subsequent transfers are encrypted.
    /// @param amount Plaintext amount to pull from msg.sender via ERC20 transferFrom
    function deposit(uint64 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // Encrypt the known plaintext amount on-chain — no client-encrypted input needed
        // because deposit amounts are already public (ERC20 transferFrom is visible)
        euint64 encAmount = FHE.asEuint64(uint256(amount));
        _balances[msg.sender] = FHE.add(_balances[msg.sender], encAmount);
        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);

        totalWrapped += amount;

        // Interactions: pull tokens last (CEI)
        IERC20(underlyingToken).safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(msg.sender, amount);
    }

    // withdraw() removed for Wave 1: FHE's constant-time FHE.select cannot conditionally
    // gate a plaintext ERC20 transfer, so any withdraw implementation either leaks balance
    // info (via revert) or allows draining (unconditional transfer). Wave 2 will implement
    // a 2-step reveal-then-claim pattern using FHE decryption callbacks.

    // -- Confidential Transfers --

    /// @notice Transfer encrypted tokens. Both balances are always updated (constant-time)
    ///         to prevent observers from learning whether the transfer succeeded.
    /// @param to Recipient address
    /// @param encAmount Client-side encrypted transfer amount (with ZK proof)
    function confidentialTransfer(
        address to,
        InEuint64 calldata encAmount
    ) external whenNotPaused {
        if (to == address(0)) revert ZeroAddress();

        euint64 amount = FHE.asEuint64(encAmount);
        _executeConfidentialTransfer(msg.sender, to, amount);
    }

    /// @notice Transfer encrypted tokens on behalf of `from`, requires prior approval.
    /// @param from Token owner
    /// @param to Recipient address
    /// @param encAmount Client-side encrypted transfer amount (with ZK proof)
    function confidentialTransferFrom(
        address from,
        address to,
        InEuint64 calldata encAmount
    ) external whenNotPaused {
        if (to == address(0)) revert ZeroAddress();
        if (!approvals[from][msg.sender]) revert NotApproved(from, msg.sender);

        euint64 amount = FHE.asEuint64(encAmount);
        _executeConfidentialTransfer(from, to, amount);
    }

    /// @dev Constant-time transfer: both sender and recipient balances are always written,
    ///      regardless of whether the sender has sufficient balance.
    function _executeConfidentialTransfer(
        address from,
        address to,
        euint64 amount
    ) private {
        ebool hasBalance = FHE.gte(_balances[from], amount);

        _balances[from] = FHE.select(
            hasBalance,
            FHE.sub(_balances[from], amount),
            _balances[from]
        );
        _balances[to] = FHE.select(
            hasBalance,
            FHE.add(_balances[to], amount),
            _balances[to]
        );

        FHE.allowThis(_balances[from]);
        FHE.allow(_balances[from], from);
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        emit ConfidentialTransfer(from, to);
    }

    // -- Approvals --

    /// @notice Approve `spender` to call confidentialTransferFrom on your behalf
    /// @param spender Address to approve
    /// @param approved Whether to grant or revoke approval
    function approve(address spender, bool approved) external {
        if (spender == address(0)) revert ZeroAddress();
        approvals[msg.sender][spender] = approved;
    }

    // -- View --

    /// @notice Returns the caller's encrypted balance handle.
    ///         Only the caller (or addresses granted FHE.allow) can decrypt this off-chain.
    /// @return The euint64 encrypted balance
    function getEncryptedBalance() external view returns (euint64) {
        return _balances[msg.sender];
    }

    /// @notice Returns the encrypted balance handle for a specific account.
    ///         Only addresses granted FHE.allow can decrypt this off-chain.
    /// @param account The address to query
    /// @return The euint64 encrypted balance
    function getEncryptedBalanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }

    // -- Admin --

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
