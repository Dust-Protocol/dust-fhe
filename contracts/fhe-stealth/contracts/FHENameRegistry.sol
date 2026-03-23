// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title FHENameRegistry
/// @notice Maps human-readable .dust names to ERC-5564 stealth meta-addresses
/// @dev FHE-ready structure for encrypted metadata fields in future iterations
contract FHENameRegistry is Ownable2Step {
    string public constant NAME_SUFFIX = ".dust";
    uint256 public constant MIN_NAME_LENGTH = 1;
    uint256 public constant MAX_NAME_LENGTH = 32;

    struct MetaAddress {
        bytes spendingPubKey;
        bytes viewingPubKey;
        uint256 registeredAt;
        bool active;
    }

    mapping(bytes32 => MetaAddress) public registry;
    mapping(bytes32 => address) public nameOwners;
    mapping(address => bytes32) public primaryNames;
    uint256 public registrationFee;

    error NameEmpty();
    error NameTooLong(uint256 length);
    error NameInvalidChars();
    error NameTaken(bytes32 nameHash);
    error NameNotFound(bytes32 nameHash);
    error NameNotActive(bytes32 nameHash);
    error NotNameOwner(bytes32 nameHash, address caller);
    error InsufficientFee(uint256 sent, uint256 required);
    error InvalidPubKeyLength(uint256 length);
    error TransferToZeroAddress();
    error WithdrawFailed();

    event NameRegistered(bytes32 indexed nameHash, address indexed owner, string name);
    event NameUpdated(bytes32 indexed nameHash);
    event NameTransferred(bytes32 indexed nameHash, address indexed from, address indexed to);
    event PrimaryNameSet(address indexed owner, bytes32 indexed nameHash);
    event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);

    constructor(uint256 _registrationFee) Ownable(msg.sender) {
        registrationFee = _registrationFee;
    }

    /// @notice Register a .dust name with stealth meta-address keys
    /// @param name The name to register (without .dust suffix)
    /// @param spendingPubKey Compressed secp256k1 spending public key (33 bytes)
    /// @param viewingPubKey Compressed secp256k1 viewing public key (33 bytes)
    function registerName(
        string calldata name,
        bytes calldata spendingPubKey,
        bytes calldata viewingPubKey
    ) external payable {
        _validateName(name);
        if (spendingPubKey.length != 33) revert InvalidPubKeyLength(spendingPubKey.length);
        if (viewingPubKey.length != 33) revert InvalidPubKeyLength(viewingPubKey.length);
        if (msg.value < registrationFee) revert InsufficientFee(msg.value, registrationFee);

        bytes32 nameHash = keccak256(abi.encodePacked(_toLowerCase(name)));
        if (nameOwners[nameHash] != address(0)) revert NameTaken(nameHash);

        registry[nameHash] = MetaAddress({
            spendingPubKey: spendingPubKey,
            viewingPubKey: viewingPubKey,
            registeredAt: block.timestamp,
            active: true
        });
        nameOwners[nameHash] = msg.sender;

        if (primaryNames[msg.sender] == bytes32(0)) {
            primaryNames[msg.sender] = nameHash;
            emit PrimaryNameSet(msg.sender, nameHash);
        }

        emit NameRegistered(nameHash, msg.sender, name);
    }

    /// @notice Resolve a .dust name to its stealth meta-address keys
    /// @param name The name to resolve (with or without .dust suffix)
    /// @return spendingPubKey The spending public key
    /// @return viewingPubKey The viewing public key
    function resolveName(string calldata name)
        external
        view
        returns (bytes memory spendingPubKey, bytes memory viewingPubKey)
    {
        string memory cleanName = _stripSuffix(name);
        bytes32 nameHash = keccak256(abi.encodePacked(_toLowerCase(cleanName)));

        MetaAddress storage meta = registry[nameHash];
        if (!meta.active) revert NameNotActive(nameHash);

        return (meta.spendingPubKey, meta.viewingPubKey);
    }

    /// @notice Update the stealth meta-address for an owned name
    /// @param name The name to update
    /// @param spendingPubKey New compressed spending public key (33 bytes)
    /// @param viewingPubKey New compressed viewing public key (33 bytes)
    function updateMetaAddress(
        string calldata name,
        bytes calldata spendingPubKey,
        bytes calldata viewingPubKey
    ) external {
        if (spendingPubKey.length != 33) revert InvalidPubKeyLength(spendingPubKey.length);
        if (viewingPubKey.length != 33) revert InvalidPubKeyLength(viewingPubKey.length);

        bytes32 nameHash = keccak256(abi.encodePacked(_toLowerCase(name)));
        if (nameOwners[nameHash] != msg.sender) revert NotNameOwner(nameHash, msg.sender);

        MetaAddress storage meta = registry[nameHash];
        meta.spendingPubKey = spendingPubKey;
        meta.viewingPubKey = viewingPubKey;

        emit NameUpdated(nameHash);
    }

    /// @notice Set a primary .dust name for the caller
    /// @param name The name to set as primary (must be owned by caller)
    function setPrimaryName(string calldata name) external {
        bytes32 nameHash = keccak256(abi.encodePacked(_toLowerCase(name)));
        if (nameOwners[nameHash] != msg.sender) revert NotNameOwner(nameHash, msg.sender);

        primaryNames[msg.sender] = nameHash;
        emit PrimaryNameSet(msg.sender, nameHash);
    }

    /// @notice Transfer ownership of a .dust name
    /// @param name The name to transfer
    /// @param newOwner The recipient address
    function transferName(string calldata name, address newOwner) external {
        if (newOwner == address(0)) revert TransferToZeroAddress();

        bytes32 nameHash = keccak256(abi.encodePacked(_toLowerCase(name)));
        if (nameOwners[nameHash] != msg.sender) revert NotNameOwner(nameHash, msg.sender);

        nameOwners[nameHash] = newOwner;

        // Clear primary name if the transferred name was the sender's primary
        if (primaryNames[msg.sender] == nameHash) {
            primaryNames[msg.sender] = bytes32(0);
        }

        emit NameTransferred(nameHash, msg.sender, newOwner);
    }

    /// @notice Update the registration fee
    /// @param fee New fee in wei
    function setRegistrationFee(uint256 fee) external onlyOwner {
        uint256 oldFee = registrationFee;
        registrationFee = fee;
        emit RegistrationFeeUpdated(oldFee, fee);
    }

    /// @notice Withdraw accumulated registration fees — CEI: no state to update before transfer
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        (bool success,) = owner().call{value: balance}("");
        if (!success) revert WithdrawFailed();
    }

    /// @notice Check if a name is available for registration
    /// @param name The name to check
    /// @return True if the name is not taken
    function isNameAvailable(string calldata name) external view returns (bool) {
        bytes32 nameHash = keccak256(abi.encodePacked(_toLowerCase(name)));
        return nameOwners[nameHash] == address(0);
    }

    function _validateName(string calldata name) internal pure {
        uint256 len = bytes(name).length;
        if (len < MIN_NAME_LENGTH) revert NameEmpty();
        if (len > MAX_NAME_LENGTH) revert NameTooLong(len);

        bytes memory b = bytes(name);
        for (uint256 i; i < len;) {
            bytes1 c = b[i];
            // a-z, A-Z, 0-9, hyphen, underscore
            bool valid = (c >= 0x61 && c <= 0x7A)
                || (c >= 0x41 && c <= 0x5A)
                || (c >= 0x30 && c <= 0x39)
                || c == 0x2D
                || c == 0x5F;
            if (!valid) revert NameInvalidChars();
            unchecked { ++i; }
        }
    }

    function _toLowerCase(string memory str) internal pure returns (string memory) {
        bytes memory b = bytes(str);
        for (uint256 i; i < b.length;) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) {
                b[i] = bytes1(uint8(b[i]) + 32);
            }
            unchecked { ++i; }
        }
        return string(b);
    }

    function _stripSuffix(string memory name) internal pure returns (string memory) {
        bytes memory b = bytes(name);
        bytes memory suffix = bytes(NAME_SUFFIX);

        if (b.length <= suffix.length) return name;

        bool hasSuffix = true;
        for (uint256 i; i < suffix.length;) {
            if (b[b.length - suffix.length + i] != suffix[i]) {
                hasSuffix = false;
                break;
            }
            unchecked { ++i; }
        }

        if (!hasSuffix) return name;

        bytes memory result = new bytes(b.length - suffix.length);
        for (uint256 i; i < result.length;) {
            result[i] = b[i];
            unchecked { ++i; }
        }
        return string(result);
    }
}
