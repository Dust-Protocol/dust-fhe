import type { Address } from 'viem';

// Arbitrum Sepolia chain ID for CoFHE deployment
export const FHE_CHAIN_ID = 421614;

export const FHE_CONTRACTS = {
  mockUSDC: '0xdD58339deD3efcF2Ddd1bf06045cF4A74ED472b7' as Address,
  confidentialToken: '0xD8fc2100EDB4E26C963cbC5BCe2ec717b2bB6661' as Address,
  nameRegistry: '0x31DdFEB4Fc83a248E8CD48991c4C8E68EB96B537' as Address,
  stealthTransfer: '0x6839919dE260F1023b14BEe365D80390F6bA53f5' as Address,
} as const;

// ConfidentialToken ABI — FHE-wrapped ERC20 with encrypted balances
export const ConfidentialTokenABI = [
  {
    type: 'function',
    name: 'deposit',
    inputs: [{ name: 'amount', type: 'uint64' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'confidentialTransfer',
    inputs: [
      { name: 'to', type: 'address' },
      {
        name: 'encAmount',
        type: 'tuple',
        components: [
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'confidentialTransferFrom',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      {
        name: 'encAmount',
        type: 'tuple',
        components: [
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getEncryptedBalance',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'euint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getEncryptedBalanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'euint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'approvals',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalWrapped',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'underlyingToken',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'amount', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ConfidentialTransfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
    ],
  },
] as const;

// FHEStealthTransfer ABI — connects stealth addresses with FHE encrypted amounts
export const FHEStealthTransferABI = [
  {
    type: 'function',
    name: 'stealthSend',
    inputs: [
      { name: 'stealthAddress', type: 'address' },
      {
        name: 'encAmount',
        type: 'tuple',
        components: [
          { name: 'data', type: 'bytes' },
        ],
      },
      { name: 'ephemeralPubKey', type: 'bytes' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'stealthSendNative',
    inputs: [
      { name: 'stealthAddress', type: 'address' },
      { name: 'ephemeralPubKey', type: 'bytes' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'batchStealthSend',
    inputs: [
      {
        name: 'sends',
        type: 'tuple[]',
        components: [
          { name: 'stealthAddress', type: 'address' },
          {
            name: 'encAmount',
            type: 'tuple',
            components: [
              { name: 'data', type: 'bytes' },
            ],
          },
          { name: 'ephemeralPubKey', type: 'bytes' },
          { name: 'metadata', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'token',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalTransfers',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'SCHEME_ID',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'StealthTransfer',
    inputs: [
      { name: 'schemeId', type: 'uint256', indexed: true },
      { name: 'stealthAddress', type: 'address', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
      { name: 'ephemeralPubKey', type: 'bytes', indexed: false },
      { name: 'metadata', type: 'bytes', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'StealthNativeTransfer',
    inputs: [
      { name: 'schemeId', type: 'uint256', indexed: true },
      { name: 'stealthAddress', type: 'address', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
      { name: 'ephemeralPubKey', type: 'bytes', indexed: false },
      { name: 'metadata', type: 'bytes', indexed: false },
    ],
  },
] as const;

// FHENameRegistry ABI — .dust name resolution for stealth meta-addresses
export const FHENameRegistryABI = [
  {
    type: 'function',
    name: 'registerName',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'spendingPubKey', type: 'bytes' },
      { name: 'viewingPubKey', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'resolveName',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [
      { name: 'spendingPubKey', type: 'bytes' },
      { name: 'viewingPubKey', type: 'bytes' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isNameAvailable',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'updateMetaAddress',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'spendingPubKey', type: 'bytes' },
      { name: 'viewingPubKey', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registrationFee',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'primaryNames',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nameOwners',
    inputs: [{ name: 'nameHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'NameRegistered',
    inputs: [
      { name: 'nameHash', type: 'bytes32', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'NameUpdated',
    inputs: [
      { name: 'nameHash', type: 'bytes32', indexed: true },
    ],
  },
] as const;

// Standard ERC20 ABI for MockUSDC (approve + transferFrom for deposit flow)
export const MockUSDCABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;
