# Dust FHE — Confidential Stealth Transfers

## The Problem

On-chain payments are fully transparent. Every transaction reveals WHO you pay, HOW MUCH you send, and WHEN you send it. This makes crypto payments unsuitable for payroll, donations, B2B settlements, and any scenario where financial privacy matters.

Existing solutions address only part of the problem:
- **Stealth addresses** hide the recipient but leave amounts visible
- **Mixers/tumblers** obscure amounts but are slow, expensive, and regulatory targets

There is no production-ready solution that hides BOTH the recipient AND the amount on EVM chains.

## Our Solution

Dust FHE combines two cryptographic primitives into one protocol:

- **Stealth Addresses** (ERC-5564/6538) hide WHO receives payment
- **Fhenix FHE** (CoFHE) hide HOW MUCH is transferred

Together, they provide complete payment privacy: an observer sees that a transaction occurred, but learns neither the recipient's identity nor the transfer amount.

## How It Works

```
                         Dust FHE Protocol
                         =================

  Sender                    On-Chain                    Recipient
  ------                    --------                    ---------

  1. Resolve "alice.dust"
     via FHENameRegistry
          |
          v
  2. Get stealth meta-address
     (spending + viewing keys)
          |
          v
  3. Derive one-time            FHEStealthTransfer
     stealth address   ------> .stealthSend()
     via ECDH (ERC-5564)        |
          |                     |-- confidentialTransferFrom()
          |                     |   (encrypted amount via FHE)
          |                     |
          |                     |-- emit StealthTransfer
          |                     |   (ephemeral pubkey, NO amount)
          |                     v
          |               ConfidentialToken
          |                 encrypted balance[stealth] += enc(amount)
          |                 encrypted balance[sender]  -= enc(amount)
          |
          |                                          4. Scan announcements
          |                                             with viewing key
          |                                                   |
          |                                          5. Derive stealth
          |                                             private key
          |                                                   |
          |                                          6. Decrypt balance
          |                                             via cofhejs SDK
```

**Privacy guarantees:**
- Amount: encrypted via FHE (never revealed on-chain, not even to validators)
- Recipient: hidden behind a one-time stealth address (unlinkable to real identity)
- Sender-recipient link: broken by stealth address derivation (only scanning reveals it)

## Contracts

| Contract | Description |
|----------|-------------|
| `ConfidentialToken.sol` | FHE-wrapped ERC20 with encrypted balances. Users deposit plaintext USDC and receive encrypted cUSDC. All subsequent transfers operate on ciphertexts. |
| `FHEStealthTransfer.sol` | Connects stealth addresses with FHE transfers. Supports single sends, batch sends (payroll), and native ETH stealth sends. Follows ERC-5564 announcement pattern. |
| `FHENameRegistry.sol` | Maps human-readable `.dust` names to ERC-5564 stealth meta-addresses. Supports registration, transfer, primary name resolution. |
| `MockUSDC.sol` | Minimal ERC20 mock for testnet deployments. |

## Tech Stack

- **FHE Runtime:** Fhenix CoFHE (`@fhenixprotocol/cofhe-contracts`, `@cofhe/sdk`)
- **Stealth Addresses:** ERC-5564 (Stealth Address Announcements) + ERC-6538 (Stealth Meta-Address Registry)
- **Smart Contracts:** Solidity 0.8.25, OpenZeppelin v5
- **Toolchain:** Hardhat + CoFHE plugin (`@cofhe/hardhat-plugin`)
- **Target Network:** Arbitrum Sepolia (chain ID 421614)
- **Frontend:** Next.js, cofhejs SDK, viem/wagmi

## Quick Start

### Prerequisites

- Node.js >= 18
- An Arbitrum Sepolia RPC URL
- A funded deployer wallet (Arbitrum Sepolia ETH)

### Install

```bash
cd contracts/fhe-stealth
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:
```
PRIVATE_KEY=<your-deployer-private-key>
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
```

### Compile

```bash
npm run compile
```

### Test

```bash
npm test
```

### Deploy to Arbitrum Sepolia

```bash
npm run deploy-arb
```

This deploys all four contracts, mints 1M test USDC to the deployer, and saves addresses to `deployments/arb-sepolia.json`.

### Deploy to Base Sepolia

```bash
npm run deploy-base
```

## Test Results

69 tests passing across 3 contract test suites:

- **ConfidentialToken** (23 tests) — deposit, encrypted transfer, transferFrom, approvals, access control, pause/unpause
- **FHENameRegistry** (25 tests) — registration, resolution, name transfer, primary names, fee management, validation
- **FHEStealthTransfer** (21 tests) — stealth send, batch send, native ETH send, event emission, access control

All tests use CoFHE mock mode (`@cofhe/hardhat-plugin`) for deterministic FHE operations without a live coprocessor.

## Security

A security review was completed covering all contracts (see `SECURITY_REVIEW.md`).

**Key findings addressed:**
- **C-1 (Critical):** Withdraw drain vulnerability — resolved by removing `withdraw()` entirely for Wave 1. A 2-step reveal-then-claim pattern will be implemented in Wave 2 using FHE decryption callbacks.
- **H-1 (High):** Deposit amount mismatch — resolved by computing the encrypted value on-chain from the plaintext deposit amount (`FHE.asEuint64(uint256(amount))`), eliminating any client-encrypted input.

**FHE-specific security patterns:**
- `FHE.allowThis()` on every balance mutation (contract retains compute access)
- `FHE.allow(handle, owner)` grants decryption access only to the balance owner
- `FHE.select()` for constant-time branching (no balance leakage via reverts)
- No amount in events — `ConfidentialTransfer` emits only `(from, to)`

## Wave Roadmap

| Wave | Milestone | Status |
|------|-----------|--------|
| **1** | Stealth Transfers — encrypted send/receive with .dust names | Current |
| **2** | FHE Privacy Pool — batched deposits, 2-step withdrawals, break deposit/withdraw correlation | Planned |
| **3** | Encrypted DeFi — confidential swaps, private limit orders on encrypted order books | Planned |
| **4** | Production Hardening — formal verification, audit, mainnet gas optimization | Planned |
| **5** | Mainnet Launch — multi-chain deployment, institutional privacy features | Planned |

## Architecture Decisions

**Why FHE over ZK for amounts?**
ZK proofs hide amounts from observers but reveal them to validators during proof verification. FHE encrypts amounts such that even the chain's validators never see plaintext values. The FHE coprocessor performs arithmetic on ciphertexts directly.

**Why stealth addresses over mixers?**
Mixers require fixed denomination pools and introduce timing/amount correlation attacks. Stealth addresses provide per-payment unlinkability with no pool, no waiting period, and arbitrary amounts.

**Why no `withdraw()` in Wave 1?**
FHE's constant-time `select` cannot conditionally gate a plaintext ERC20 transfer without leaking balance information via revert/success. Wave 2 will implement a 2-step pattern: encrypted deduction followed by a decryption callback that releases tokens.

## Team

Dust Protocol — [github.com/Dust-Protocol/dust-fhe](https://github.com/Dust-Protocol/dust-fhe)
