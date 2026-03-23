# MASTER PLAN: Dust Protocol × Fhenix FHE Buildathon

## Wave Strategy

| Wave | Focus | Deliverable | Grant |
|------|-------|------------|-------|
| **Wave 1** (Mar 21-28) | **FHE Stealth Transfers** | Confidential send/receive with encrypted amounts | $3K |
| Wave 2 (Mar 30 - Apr 6) | FHE Privacy Pool | Encrypted deposit/withdraw pool | $5K |
| Wave 3 (Apr 8 - May 8) | Full DeFi Suite | Prediction markets, swaps, compliance | $12K |
| Wave 4 (May 11-20) | Production Polish | Mainnet prep, audits, docs | $14K |
| Wave 5 (May 23 - Jun 1) | Launch | Demo day, mainnet deploy | $14K + $2K bonus |

---

## WAVE 1: Confidential Stealth Transfers

### What We're Building

**Stealth addresses hide WHO. FHE hides HOW MUCH. Together = complete payment privacy.**

Existing Dust Protocol has production stealth transfers (ECDH, ERC-5564/6538). We're adding Fhenix FHE to encrypt ALL transfer amounts — nobody on-chain can see how much was sent, not even the sender's balance.

### Architecture

```
Sender                                          Recipient
  │                                                │
  │ 1. Resolve .dust name                          │
  ▼                                                │
  ┌──────────────────────┐                         │
  │ cofhejs.encrypt()    │                         │
  │ amount → InEuint64   │                         │
  └──────────┬───────────┘                         │
             │                                     │
  2. ECDH → stealth address (WHO is hidden)        │
             │                                     │
  ┌──────────▼───────────────────────────────────┐ │
  │         FHEStealthTransfer.sol               │ │
  │                                              │ │
  │  stealthSend(stealthAddr, InEuint64 amount)  │ │
  │    ├─ FHE.asEuint64(amount)  // verify ZKP   │ │
  │    ├─ balances[sender] -= amount (encrypted)  │ │
  │    ├─ balances[stealth] += amount (encrypted) │ │
  │    ├─ FHE.allowThis(...)                     │ │
  │    └─ FHE.allow(balance, stealthAddr)        │ │
  │                                              │ │
  │  Uses ConfidentialToken.sol (euint64 ERC20)  │ │
  └──────────────────────────────────────────────┘ │
                                                   │
  3. Recipient scans stealth announcements          │
                                                   ▼
                                          ┌────────────────┐
                                          │ useDecrypt()   │
                                          │ View balance   │
                                          │ (only they can │
                                          │  see amount)   │
                                          └────────┬───────┘
                                                   │
                                          4. claim() → move
                                             to main wallet
```

### Contracts

#### 1. ConfidentialToken.sol
FHE-wrapped ERC20. All balances stored as `euint64`.

```solidity
// Core functions:
deposit(InEuint64 amount)           // wrap tokens → encrypted balance
withdraw(uint64 amount)              // unwrap (requires public decrypt)
confidentialTransfer(to, InEuint64)  // encrypted transfer
getBalance(Permission perm)          // sealed output → only caller sees
```

#### 2. FHEStealthTransfer.sol
Encrypted stealth send/receive. Combines ECDH (ERC-5564) with FHE amounts.

```solidity
// Core functions:
stealthSend(stealthAddr, InEuint64 amount)  // send to stealth address
claim(stealthAddr, mainWallet)               // recipient claims
getIncoming(Permission perm)                 // view pending payments
```

#### 3. FHENameRegistry.sol
Enhanced `.dust` name registry with FHE metadata.

```solidity
// Core functions:
registerName(name, metaAddress)     // register .dust name
resolveName(name)                   // resolve to meta-address
```

### Frontend

Adapt existing Dust pay page + dashboard:

1. **Pay Page** (`/pay/[name]`) — Enter .dust name, amount encrypted client-side via `useEncrypt`, sent to stealth address
2. **Receive Page** — Scan for incoming stealth payments, `useDecrypt` to view amounts, claim to wallet
3. **Dashboard** — Encrypted balance display, transaction history

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Contracts | Solidity 0.8.25, @fhenixprotocol/cofhe-contracts |
| Testing | Hardhat + @cofhe/hardhat-plugin (mock mode) |
| Client SDK | @cofhe/sdk (cofhejs), @cofhe/react |
| Frontend | Next.js 14, React 18, viem, wagmi |
| Auth | Privy (existing) |
| Chain | Arbitrum Sepolia (primary) |

### 7-Day Schedule

| Day | Focus | Deliverables |
|-----|-------|-------------|
| **Day 1** (Mar 21) | Project setup | Hardhat + CoFHE configured, ConfidentialToken.sol written + tested in mock |
| **Day 2** (Mar 22) | Core transfer | FHEStealthTransfer.sol with encrypted send/receive, mock tests passing |
| **Day 3** (Mar 23) | Name registry + integration | FHENameRegistry.sol, end-to-end: name → stealth → encrypted transfer |
| **Day 4** (Mar 24) | Frontend: send | Pay page with @cofhe/react encryption, chain selector |
| **Day 5** (Mar 25) | Frontend: receive | Claim page with useDecrypt, balance display, scanning |
| **Day 6** (Mar 26) | Deploy + test | Arbitrum Sepolia deployment, end-to-end testnet test |
| **Day 7** (Mar 27) | Polish + submit | UX polish, docs, demo walkthrough, AKINDO submission |

### Task Dependency Graph (Pyramid)

```
[5] Hardhat Setup
 ├── [1] ConfidentialToken.sol
 │    ├── [15] FHEStealthTransfer.sol
 │    │    ├── [17] Frontend: Pay Page
 │    │    ├── [18] Frontend: Claim Page
 │    │    ├── [19] Test Suite
 │    │    └── [21] Security Review
 │    └── [16] FHENameRegistry.sol
 │         ├── [19] Test Suite
 │         └── [21] Security Review
 └── [16] FHENameRegistry.sol
      └── ...

[19] Tests + [21] Security Review
 └── [20] Deploy + Submission Docs
```

### Judging Criteria Alignment

| Criteria | How We Score |
|----------|-------------|
| **Privacy Architecture** | Stealth addresses (WHO) + FHE encrypted amounts (HOW MUCH) = complete privacy. Two orthogonal privacy layers is architecturally superior. |
| **Innovation** | First protocol combining ERC-5564 stealth addresses with Fhenix FHE encrypted balances. Novel fusion. |
| **User Experience** | Existing Dust pay page adapted — send to .dust names, amounts encrypted transparently. Recipient decrypts only their own. |
| **Technical Execution** | Proper FHE patterns (allowThis, select, no branching). CoFHE mock tests. Clean Solidity. |
| **Market Potential** | Private payments is the #1 use case. Stealth + FHE solves it completely. Institutional demand is real. |

### Wave 2+ Roadmap Preview

Show judges the vision beyond Wave 1:

- **Wave 2**: FHE Privacy Pool (encrypted deposit/withdraw, replaces ZK-UTXO with FHE)
- **Wave 3**: Encrypted DeFi (prediction markets, private swaps, FHE compliance)
- **Wave 4**: Production hardening (gas optimization, audit, mainnet prep)
- **Wave 5**: Mainnet launch on Arbitrum

### Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| CoFHE testnet down | Mock mode for all dev/testing, deploy last 2 days |
| Gas too high for FHE transfers | Use euint32 for amounts if needed, minimize ops |
| Decryption latency | Optimistic UI with loading states, pre-fetch permits |
| Scope creep | ONLY stealth transfers for Wave 1. Pool/DeFi is Wave 2+. |

### FHE Patterns Cheat Sheet

```solidity
// ALWAYS after mutating encrypted state:
balance = FHE.add(balance, amount);
FHE.allowThis(balance);  // MANDATORY or next tx reverts

// NEVER branch on encrypted values:
// BAD:  if (FHE.decrypt(hasBalance)) { ... }
// GOOD: newBal = FHE.select(hasBalance, FHE.sub(bal, amt), bal);

// Constant-time transfer:
ebool hasBalance = FHE.gte(senderBal, amount);
senderBal = FHE.select(hasBalance, FHE.sub(senderBal, amount), senderBal);
recipBal  = FHE.select(hasBalance, FHE.add(recipBal, amount), recipBal);

// Client encryption:
const [encAmount] = await cofhejs.encrypt([Encryptable.uint64(BigInt(100))]);

// Private view (no on-chain tx):
const result = await client.decryptForView(ctHash).withPermit().execute();
```
