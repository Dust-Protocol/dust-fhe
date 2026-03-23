// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {FHE, euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IConfidentialToken {
    function confidentialTransferFrom(address from, address to, InEuint64 calldata encAmount) external;
    function approve(address spender, bool approved) external;
}

/// @title FHEStealthTransfer
/// @notice Connects stealth addresses (hiding WHO) with FHE encrypted amounts (hiding HOW MUCH).
///         Senders derive one-time stealth addresses client-side via ECDH, then send encrypted
///         tokens through this contract. Recipients scan announcements to discover payments.
contract FHEStealthTransfer is Ownable2Step, ReentrancyGuard {

    // -- Errors --

    error ZeroAddress();
    error NativeTransferFailed();
    error EmptySendsArray();

    // -- Events --

    /// @dev Follows ERC-5564 announcement pattern. NO amount — that's the entire point of FHE.
    event StealthTransfer(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    event StealthNativeTransfer(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    // -- Structs --

    struct StealthSendParams {
        address stealthAddress;
        InEuint64 encAmount;
        bytes ephemeralPubKey;
        bytes metadata;
    }

    // -- State --

    IConfidentialToken public token;
    uint256 public totalTransfers;
    /// @dev ERC-5564 scheme ID: 1 = secp256k1
    uint256 public constant SCHEME_ID = 1;

    // -- Constructor --

    /// @param _token Address of the ConfidentialToken contract
    /// @param _owner Admin address
    constructor(address _token, address _owner) Ownable(_owner) {
        if (_token == address(0)) revert ZeroAddress();
        token = IConfidentialToken(_token);
    }

    // -- External Functions --

    /// @notice Send encrypted tokens to a one-time stealth address
    /// @dev Sender must have approved this contract on ConfidentialToken first.
    ///      The ephemeralPubKey is published so recipients can derive the stealth private key.
    /// @param stealthAddress One-time address derived client-side via ECDH
    /// @param encAmount FHE-encrypted transfer amount
    /// @param ephemeralPubKey Sender's ephemeral public key (compressed, 33 bytes)
    /// @param metadata View tag (first byte) + optional data for efficient scanning
    function stealthSend(
        address stealthAddress,
        InEuint64 calldata encAmount,
        bytes calldata ephemeralPubKey,
        bytes calldata metadata
    ) external nonReentrant {
        if (stealthAddress == address(0)) revert ZeroAddress();

        token.confidentialTransferFrom(msg.sender, stealthAddress, encAmount);

        unchecked { ++totalTransfers; }

        emit StealthTransfer(SCHEME_ID, stealthAddress, msg.sender, ephemeralPubKey, metadata);
    }

    /// @notice Send native ETH to a stealth address (no FHE — amount is visible on-chain)
    /// @param stealthAddress One-time address derived client-side via ECDH
    /// @param ephemeralPubKey Sender's ephemeral public key (compressed, 33 bytes)
    /// @param metadata View tag + optional data
    function stealthSendNative(
        address stealthAddress,
        bytes calldata ephemeralPubKey,
        bytes calldata metadata
    ) external payable nonReentrant {
        if (stealthAddress == address(0)) revert ZeroAddress();

        // Effects before interactions (CEI)
        unchecked { ++totalTransfers; }

        // Interactions: forward ETH
        (bool success,) = stealthAddress.call{value: msg.value}("");
        if (!success) revert NativeTransferFailed();

        emit StealthNativeTransfer(SCHEME_ID, stealthAddress, msg.sender, ephemeralPubKey, metadata);
    }

    /// @notice Batch send encrypted tokens to multiple stealth addresses in one tx
    /// @dev Gas-efficient for payroll-like use cases. Sender must have approved this contract.
    /// @param sends Array of stealth send parameters
    function batchStealthSend(StealthSendParams[] calldata sends) external nonReentrant {
        uint256 length = sends.length;
        if (length == 0) revert EmptySendsArray();

        for (uint256 i; i < length;) {
            StealthSendParams calldata s = sends[i];
            if (s.stealthAddress == address(0)) revert ZeroAddress();

            token.confidentialTransferFrom(msg.sender, s.stealthAddress, s.encAmount);

            emit StealthTransfer(SCHEME_ID, s.stealthAddress, msg.sender, s.ephemeralPubKey, s.metadata);

            unchecked { ++i; }
        }

        unchecked { totalTransfers += length; }
    }
}
