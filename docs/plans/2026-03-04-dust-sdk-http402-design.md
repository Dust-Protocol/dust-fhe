# Dust SDK + HTTP 402 Distribution Layer — Design Document

**Date:** 2026-03-04
**Branch:** `feat/dust-sdk-http402-distribution`
**Status:** Approved

---

## 1. Problem Statement

Dust Protocol has production-grade privacy technology (stealth addresses, ZK-UTXO pool, private swaps) but zero distribution layer. All functionality is locked inside a Next.js app with React hooks. No standalone SDK, no HTTP-native payment flow, no merchant integration path.

The x402 agent payment ecosystem (Coinbase, Stripe, Google) is growing fast with zero privacy option. b402 (BNB Chain's x402 implementation) has HTTP-native payments and standalone SDK but zero cryptographic privacy. Dust can own "private payments for agents" by building distribution around its existing technology.

## 2. Decision: Approach A — Extract & Abstract

Extract existing `src/lib/` code into SDK packages with minimal changes. Add abstraction interfaces for environment-specific concerns (storage, proof engine, providers). Existing Next.js app becomes a consumer of the SDK.

**Why not clean-room rewrite:** Crypto-critical code has been audited twice with 45+ findings fixed. Rewriting introduces regression risk. The existing `src/lib/` has zero React imports — extraction is mechanical.

## 3. Scope — Full Stack (P0-P4)

| Priority | Component | Type | Effort |
|----------|-----------|------|--------|
| P0 | `@dust/core` | Extract | 1 week |
| P0 | `@dust/stealth` | Extract | 1 week |
| P0 | `@dust/pool` | Extract + abstract | 1.5 weeks |
| P1 | `@dust/http402` | New | 2 weeks |
| P2 | `@dust/express` | New | 1 week |
| P3 | Prometheus metrics | New | 2-3 days |
| P4 | Token whitelist | Contract change | 1-2 days |
| — | `@dust/sdk` | Re-export | 1 day |

**Total: ~6-8 weeks**

## 4. Monorepo Structure

```
dust-sdk/                          # Separate repo: github.com/0xSY3/dust-sdk
├── packages/
│   ├── core/                      # Crypto primitives, key derivation, types
│   │   ├── src/
│   │   │   ├── keys.ts            # V0/V1/V2 key derivation (PBKDF2 + BN254)
│   │   │   ├── poseidon.ts        # Poseidon2 hashing (circomlibjs)
│   │   │   ├── commitment.ts      # Poseidon(owner, amount, asset, chainId)
│   │   │   ├── nullifier.ts       # Poseidon(nullifierKey, leafIndex)
│   │   │   ├── note.ts            # NoteV2 creation with random blinding
│   │   │   ├── chains.ts          # Chain config registry
│   │   │   ├── constants.ts       # BN254_FIELD_SIZE, TREE_DEPTH, MAX_AMOUNT
│   │   │   ├── errors.ts          # DustError hierarchy
│   │   │   └── types.ts           # All shared types
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── stealth/                   # Stealth address operations (ERC-5564/6538)
│   │   ├── src/
│   │   │   ├── address.ts         # ECDH stealth address generation
│   │   │   ├── scanner.ts         # On-chain announcement scanning
│   │   │   ├── registry.ts        # ERC-6538 meta-address registration
│   │   │   ├── names.ts           # .dust name registration + resolution
│   │   │   ├── pin.ts             # PIN-based key derivation
│   │   │   ├── hdWallet.ts        # HD claim address derivation
│   │   │   ├── eip7702.ts         # EIP-7702 delegation
│   │   │   └── relayer.ts         # Stealth relayer client
│   │   └── package.json           # depends on @dust/core
│   │
│   ├── pool/                      # DustPool V2 operations
│   │   ├── src/
│   │   │   ├── deposit.ts         # Deposit flow
│   │   │   ├── withdraw.ts        # Withdrawal (proof → relayer)
│   │   │   ├── transfer.ts        # Private transfer (2-in-2-out)
│   │   │   ├── split.ts           # Denomination splitting (2-in-8-out)
│   │   │   ├── proof.ts           # IProofEngine + implementations
│   │   │   ├── split-proof.ts     # Split circuit proofs
│   │   │   ├── proof-inputs.ts    # Circuit input builder
│   │   │   ├── denominations.ts   # Denomination tiers + splitting algo
│   │   │   ├── compliance.ts      # Chainalysis oracle screening
│   │   │   ├── viewkey.ts         # View key + selective disclosure
│   │   │   ├── storage.ts         # IStorageBackend + implementations
│   │   │   ├── storage-crypto.ts  # AES-256-GCM encryption
│   │   │   ├── relayer.ts         # Pool relayer client
│   │   │   └── contracts.ts       # DustPoolV2 ABI (viem-typed)
│   │   └── package.json           # depends on @dust/core
│   │
│   ├── http402/                   # HTTP 402 Private Payment Protocol
│   │   ├── src/
│   │   │   ├── types.ts           # PaymentRequirement, PaymentProof, PrivacyLevel
│   │   │   ├── server.ts          # Payment verification (seller side)
│   │   │   ├── client.ts          # Payment execution (buyer/agent side)
│   │   │   ├── headers.ts         # X-Dust-402 header encoding/decoding
│   │   │   ├── facilitator.ts     # Facilitator client (verify + settle)
│   │   │   └── receipt.ts         # Payment receipt generation + verification
│   │   └── package.json           # depends on @dust/core, @dust/stealth, @dust/pool
│   │
│   ├── express/                   # Express.js middleware
│   │   ├── src/
│   │   │   ├── middleware.ts      # dustPaywall() middleware factory
│   │   │   ├── config.ts          # Middleware config types
│   │   │   └── errors.ts          # PaymentRequired error class
│   │   └── package.json           # depends on @dust/http402
│   │
│   └── sdk/                       # Unified re-export
│       ├── src/
│       │   └── index.ts           # Re-exports all packages
│       └── package.json           # depends on all @dust/* packages
│
├── examples/
│   ├── agent-payment/             # AI agent paying for API access
│   ├── express-paywall/           # Express.js route behind private payment
│   ├── node-transfer/             # Node.js private transfer script
│   └── stealth-send/              # Stealth address send from CLI
│
├── turbo.json                     # Turborepo config
├── package.json                   # Root workspace
├── tsconfig.base.json             # Shared TS config
└── vitest.workspace.ts            # Shared test config
```

**Dependency graph:**
```
@dust/sdk → @dust/http402 → @dust/pool → @dust/core
                  │             │
                  └→ @dust/stealth → @dust/core
                  │
@dust/express ────┘
```

## 5. Core Abstractions

### 5.1 Provider Injection

```typescript
// @dust/core — no ethers/viem lock-in at API surface
interface DustProvider {
  getChainId(): Promise<number>;
  call(to: Address, data: `0x${string}`): Promise<`0x${string}`>;
  sendTransaction(tx: TransactionRequest): Promise<`0x${string}`>;
  getLogs(filter: LogFilter): Promise<Log[]>;
  waitForTransaction(hash: `0x${string}`): Promise<TransactionReceipt>;
}

// Adapters
function fromViem(client: PublicClient, wallet?: WalletClient): DustProvider;
function fromEthers(provider: ethers.Provider, signer?: ethers.Signer): DustProvider;
function fromRpcUrl(url: string): DustProvider;
```

### 5.2 Storage Backend

```typescript
// @dust/pool — abstract note storage
interface IStorageBackend {
  saveNote(note: StoredNoteV2): Promise<void>;
  getNote(id: string): Promise<StoredNoteV2 | null>;
  getNotes(filter: NoteFilter): Promise<StoredNoteV2[]>;
  markSpent(id: string, txHash: string): Promise<void>;
  deleteNote(id: string): Promise<void>;
  clear(): Promise<void>;
}

// Shipped implementations
class IndexedDbStorage implements IStorageBackend { ... }  // browser
class InMemoryStorage implements IStorageBackend { ... }   // testing/agents
class JsonFileStorage implements IStorageBackend { ... }   // Node.js CLI
```

Encryption wraps any backend: `EncryptedStorage(backend, encryptionKey)`.

### 5.3 Proof Engine

```typescript
// @dust/pool — abstract proof generation
interface IProofEngine {
  generateProof(input: ProofInputs, circuitType: 'transaction' | 'split'): Promise<ProofResult>;
}

// Shipped implementations
class BrowserProofEngine implements IProofEngine { ... }  // Web Worker
class NodeProofEngine implements IProofEngine { ... }     // Direct snarkjs
```

Auto-detection: `typeof window !== 'undefined'` picks browser engine, else Node.

### 5.4 SDK Initialization

```typescript
import { DustSDK } from '@dust/sdk';

// Agent / Node.js
const dust = DustSDK.create({
  provider: DustSDK.fromRpcUrl('https://...'),
  signer: privateKey,
  chainId: 11155111,
  storage: new JsonFileStorage('./dust-notes.json'),
});

// Browser (viem/wagmi)
const dust = DustSDK.create({
  provider: DustSDK.fromViem(publicClient, walletClient),
  chainId: chain.id,
});

// Usage
const keys = await dust.stealth.deriveKeys(signature, pin);
const { stealthAddress } = await dust.stealth.generateAddress(metaAddress);
await dust.pool.deposit({ amount: parseEther('0.1'), asset: ETH });
const receipt = await dust.pool.withdraw({ amount, recipient, notes });
```

## 6. HTTP 402 Private Payment Protocol

### 6.1 Payment Flow

```
Agent ──GET /api/premium──→ Seller
Agent ←─402 + X-Dust-402──── Seller

  SDK resolves privacy level:
    transparent → EIP-712 signed transferFrom (x402-compatible)
    stealth    → derive stealth address + direct transfer
    private    → generate ZK proof + DustPool transfer

Agent ──GET + X-Dust-Payment──→ Seller
                                  Seller ──POST /verify──→ Facilitator
                                  Seller ←─{ valid }──────── Facilitator
Agent ←─200 OK + resource──────── Seller
```

### 6.2 Privacy Levels

| Level | Settlement | Latency | Privacy |
|-------|-----------|---------|---------|
| `transparent` | EIP-712 `transferFrom` (x402-compatible) | ~2s | None |
| `stealth` | Stealth address + direct transfer | ~3s | Receiver unlinkable |
| `private` | Full DustPool ZK transfer | ~8-15s | Sender, receiver, amount hidden |

### 6.3 x402 Compatibility

`transparent` mode is wire-compatible with x402. Unmodified x402 agents can pay Dust-powered endpoints. Dust-aware agents detect `X-Dust-402` header and can upgrade to stealth/private.

### 6.4 Facilitator API

Runs as part of existing Next.js relayer:

```
/api/v2/http402/
  ├── verify    POST  — Verify payment proof
  ├── settle    POST  — Settle payment on-chain
  ├── receipt   GET   — Get payment receipt by nonce
  └── health    GET   — Facilitator status
```

### 6.5 Express Middleware

```typescript
import { dustPaywall } from '@dust/express';

app.use('/api/premium', dustPaywall({
  amount: '0.01',
  asset: 'ETH',
  privacy: 'private',
  chainId: 11155111,
  facilitator: 'https://dust-protocol.vercel.app/api/v2/http402',
  recipient: 'dust:myservice',
}));

// Dynamic pricing
app.use('/api/data', dustPaywall({
  amount: (req) => calculatePrice(req.query.dataset),
  asset: 'USDC',
  privacy: 'private',
}));
```

## 7. Prometheus Metrics

Added to existing relayer at `/api/metrics`:

```
# Counters
dust_deposits_total{chain, asset, privacy_level}
dust_withdrawals_total{chain, asset, privacy_level}
dust_transfers_total{chain, privacy_level}
dust_swaps_total{chain}
dust_http402_payments_total{chain, privacy_level, status}
dust_proofs_verified_total{chain, circuit_type, valid}

# Histograms
dust_proof_verification_duration_seconds{circuit_type}
dust_tree_sync_duration_seconds{chain}
dust_http402_settlement_duration_seconds{privacy_level}
dust_relayer_gas_used{chain, operation}

# Gauges
dust_tree_leaf_count{chain}
dust_tree_root_age_seconds{chain}
dust_pool_tvl_wei{chain, asset}
dust_active_notes_count{chain}
dust_facilitator_balance_wei{chain}
```

Privacy-safe: never log nullifiers, commitments, or individual amounts. Aggregate counters only.

## 8. Token Whitelist

Contract addition to DustPoolV2:

```solidity
mapping(address => bool) public allowedAssets;
bool public whitelistEnabled;

function setWhitelistEnabled(bool enabled) external onlyOwner;
function setAllowedAsset(address asset, bool allowed) external onlyOwner;

// In deposit(): if (whitelistEnabled && !allowedAssets[asset]) revert AssetNotAllowed(asset);
```

Opt-in — defaults to disabled. ETH (address(0)) always allowed. Prevents rebasing tokens and fee-on-transfer tokens from breaking the UTXO model.

## 9. Migration Strategy

The existing Next.js app migrates incrementally:

1. **Phase 1:** SDK published, app unchanged
2. **Phase 2:** App's `src/lib/` imports replaced with `@dust/*` imports
3. **Phase 3:** Hooks become thin wrappers around SDK calls
4. **Phase 4:** `src/lib/` deleted, fully SDK-dependent

No big bang. Hooks switch from `import { ... } from '@/lib/dustpool/v2/...'` to `import { ... } from '@dust/pool'` one at a time.

## 10. Code Budget

| Component | New Code | Extracted Code | Total |
|-----------|----------|----------------|-------|
| `@dust/core` | ~200 LOC (abstractions) | ~1,200 LOC | ~1,400 LOC |
| `@dust/stealth` | ~100 LOC (adapters) | ~1,500 LOC | ~1,600 LOC |
| `@dust/pool` | ~400 LOC (abstractions) | ~2,500 LOC | ~2,900 LOC |
| `@dust/http402` | ~1,500 LOC | — | ~1,500 LOC |
| `@dust/express` | ~400 LOC | — | ~400 LOC |
| `@dust/sdk` | ~100 LOC | — | ~100 LOC |
| Facilitator API | ~500 LOC | — | ~500 LOC |
| Metrics | ~200 LOC | — | ~200 LOC |
| Token whitelist | ~30 LOC | — | ~30 LOC |
| Tests | ~2,000 LOC | — | ~2,000 LOC |
| **Total** | **~5,430 LOC** | **~5,200 LOC** | **~10,630 LOC** |

## 11. Build & Publish

- **Monorepo tool:** Turborepo (caching, parallel builds)
- **Build:** tsup (ESM + CJS dual output per package)
- **Test:** Vitest (shared workspace config)
- **Publish:** npm (scoped @dust/* packages)
- **CI:** GitHub Actions (lint → build → test → publish on tag)
- **Versioning:** Semver, independent per package, changesets for coordination
