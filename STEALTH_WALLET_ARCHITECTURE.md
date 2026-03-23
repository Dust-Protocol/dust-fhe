# Dust Protocol — Complete FHE Stealth Wallet Architecture

**Version:** 1.0 — Wave 1-2 Design
**Date:** March 23, 2026
**Target:** Fhenix WaveHack Buildathon (Private By Design dApp Buildathon)
**Stack:** Fhenix CoFHE + ERC-5564/6538 Stealth Addresses + .dust Naming

---

## 1. Problem Statement

On-chain payments leak four pieces of information:

| Leaked Data | Who Learns It | Real-World Impact |
|-------------|--------------|-------------------|
| **Sender identity** | Everyone | Employer knows employee spending |
| **Recipient identity** | Everyone | Payee's other counterparties visible |
| **Transfer amount** | Everyone (incl. validators) | Salary, deal sizes, portfolio exposure |
| **Sender-recipient link** | Everyone | Full social payment graph |

Stealth addresses alone solve WHO but not HOW MUCH. Mixers solve HOW MUCH but not WHO (and require fixed denominations). Neither solves both simultaneously on EVM.

**Dust Protocol solves all four** by combining ECDH stealth addresses (hiding identities) with Fhenix FHE (hiding amounts). The transfer amount is encrypted such that even chain validators never see the plaintext.

---

## 2. Threat Model

### Adversaries

| Adversary | Capability | What They See Today | What They See With Dust FHE |
|-----------|-----------|--------------------|-----------------------------|
| **Chain Observer** | Reads all on-chain state & events | Sender, recipient, amount, token, timestamp | Sender address, encrypted blob, timestamp. Cannot link to recipient or amount. |
| **Block Producer / Sequencer** | Orders & reads transactions | Everything an observer sees + can front-run | Same encrypted data. Cannot extract amount for MEV. |
| **Relayer** | Submits sponsored txs | Stealth address, ephemeral key, view tag | Cannot derive stealth private key. Cannot decrypt amount. |
| **CoFHE Coprocessor** | Executes FHE ops on ciphertexts | Encrypted ciphertext handles | Computes on encrypted data. Threshold decryption prevents single-party extraction. |
| **Network Peer (recipient's contacts)** | Watches known addresses | If they know Alice's main wallet, they see her balance | Alice receives to stealth addresses. Peer sees nothing unless Alice reveals. |

### Privacy Goals

| Property | Mechanism | Guarantee Level |
|----------|-----------|----------------|
| **Sender Privacy** | Sender's main address visible on-chain, but the recipient-stealth link is hidden | Partial — sender is visible, but who they're paying is not |
| **Recipient Privacy** | ECDH one-time stealth address (ERC-5564) | Strong — new address per payment, unlinkable without viewing key |
| **Amount Privacy** | FHE encrypted amounts (euint64, CoFHE) | Strong — amount never appears in plaintext on-chain, not even to validators |
| **Link Privacy** | Stealth address + FHE metadata hides the sender→recipient graph | Strong — only the recipient with viewing key can discover payments |

### Out of Scope (Wave 1)

- Sender anonymity (sender address is visible — future: use DustPool deposit to break sender trail)
- Timing analysis resistance (future: add random delays via relayer)
- Amount range proofs (FHE handles this implicitly via encrypted arithmetic)

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DUST FHE STEALTH WALLET                              │
│                                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌─────────────┐ │
│  │  .dust Name  │   │   Stealth    │   │     FHE      │   │   Relayer   │ │
│  │  Resolution  │   │   Address    │   │  Encrypted   │   │  (Gasless)  │ │
│  │  Layer       │   │   Layer      │   │  Amount Layer│   │  Layer      │ │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬──────┘ │
│         │                  │                   │                  │        │
│         ▼                  ▼                   ▼                  ▼        │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    Smart Contract Layer                            │    │
│  │                                                                    │    │
│  │  FHENameRegistry ──► FHEStealthTransfer ◄── ConfidentialToken     │    │
│  │       │                     │                      │               │    │
│  │  name→meta-addr      stealth send +          encrypted balances   │    │
│  │  resolution          ERC-5564 announce       (euint64)            │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                    │                                       │
│                                    ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    Fhenix CoFHE Coprocessor                        │    │
│  │                                                                    │    │
│  │  euint64 arithmetic (add, sub, select, gte)                       │    │
│  │  Threshold decryption network (MPC)                                │    │
│  │  Access control (FHE.allow / FHE.allowThis)                       │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    Client Layer (Browser)                          │    │
│  │                                                                    │    │
│  │  @cofhe/sdk ─── encrypt amounts                                   │    │
│  │  @cofhe/react ── useEncrypt, useDecrypt, useConnection            │    │
│  │  @noble/secp256k1 ─── ECDH stealth address derivation            │    │
│  │  wagmi/viem ──── wallet connection & tx submission                │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Core Cryptographic Primitives

### 4.1 Stealth Addresses (ERC-5564 / ERC-6538)

**Purpose:** Hide the recipient. Every payment goes to a fresh, one-time address that cannot be linked back to the recipient's main wallet without the viewing key.

**Key Pairs:**
- **Spending Key Pair** `(s, S)` — `S = s·G` — Controls funds at stealth addresses
- **Viewing Key Pair** `(v, V)` — `V = v·G` — Scans for incoming payments (read-only)
- **Stealth Meta-Address** = `st:eth:0x{S_compressed}{V_compressed}` (66 bytes total)

**Derivation Protocol (per payment):**

```
SENDER SIDE:
─────────────
1. Generate ephemeral key pair:  (r, R) where R = r·G
2. Compute shared secret:        shared = r · V  (ECDH with recipient's viewing key)
3. Derive secret hash:           h = keccak256(shared)
4. Compute view tag:             viewTag = h[0:1]  (first byte, for fast scanning)
5. Derive stealth public key:    P_stealth = S + h·G  (point addition)
6. Derive stealth address:       addr = keccak256(P_stealth)[12:32]
7. Publish on-chain:             (R, viewTag, metadata) via StealthTransfer event
8. Send encrypted tokens TO:     addr

RECIPIENT SIDE (scanning):
──────────────────────────
1. See event with ephemeral key R
2. Compute shared secret:        shared = v · R  (same ECDH result, different path)
3. Derive secret hash:           h = keccak256(shared)
4. Check view tag:               if h[0:1] ≠ event.viewTag → skip (fast filter)
5. Derive stealth public key:    P_stealth = S + h·G
6. Derive stealth address:       addr = keccak256(P_stealth)[12:32]
7. If addr matches event:        THIS PAYMENT IS FOR ME
8. Derive stealth private key:   p_stealth = s + h  (mod curve order)
   → This key controls the stealth address
```

**Security Property:** Only the holder of the viewing private key `v` can discover payments. Only the holder of the spending private key `s` can move funds.

### 4.2 FHE Encrypted Amounts (Fhenix CoFHE)

**Purpose:** Hide the transfer amount. The amount is encrypted client-side and all arithmetic happens on ciphertexts via the CoFHE coprocessor. The plaintext never appears on-chain.

**Encryption Model:**

```
CLIENT SIDE (sender):
─────────────────────
1. User enters amount (e.g., 1000 USDC = 1000000 in 6-decimal format)
2. cofhejs.encrypt(Encryptable.uint64(1000000n))
   → Produces InEuint64: { data: encrypted_bytes, signature: zkp_proof }
   → ZK proof proves the sender knows the plaintext without revealing it
3. Submit InEuint64 to smart contract

ON-CHAIN (CoFHE coprocessor):
─────────────────────────────
4. FHE.asEuint64(inEncAmount) → validates ZKP, returns euint64 handle
5. FHE.sub(senderBalance, amount) → encrypted subtraction
6. FHE.add(recipientBalance, amount) → encrypted addition
7. FHE.gte(senderBalance, amount) → encrypted comparison → ebool
8. FHE.select(hasBalance, newBal, oldBal) → constant-time conditional
   → ALL of this operates on ciphertexts. The coprocessor never sees plaintext.

CLIENT SIDE (recipient):
────────────────────────
9. cofhejs.decrypt(encryptedBalanceHandle)
   → Threshold decryption network decrypts for the authorized party
   → Only the address granted FHE.allow() can trigger decryption
```

**Key FHE Types Used:**

| Type | Size | Use Case |
|------|------|----------|
| `euint64` | 64-bit encrypted uint | Token amounts (supports up to ~18.4 quintillion base units) |
| `ebool` | Encrypted boolean | Balance sufficiency checks (`gte` result) |
| `eaddress` | Encrypted address | Future: hide recipient address on-chain |
| `InEuint64` | Input encrypted uint64 | Client-submitted encrypted amount with ZKP |

**Critical FHE Patterns:**

```solidity
// ALWAYS after mutating encrypted state — or next tx reverts:
FHE.allowThis(newBalance);           // Contract retains compute access
FHE.allow(newBalance, ownerAddress); // Owner gets decryption access

// NEVER branch on encrypted values — leaks information:
// BAD:  if (FHE.decrypt(hasBalance)) { ... }
// GOOD: result = FHE.select(hasBalance, ifTrue, ifFalse);  // constant-time

// Constant-time transfer (no information leakage via revert/success):
ebool ok = FHE.gte(senderBal, amount);
senderBal = FHE.select(ok, FHE.sub(senderBal, amount), senderBal);
recipBal  = FHE.select(ok, FHE.add(recipBal, amount), recipBal);
// Both paths ALWAYS execute. Observer cannot tell if transfer succeeded.
```

### 4.3 .dust Name Resolution

**Purpose:** Human-readable payment endpoints. Users send to `alice.dust` instead of a 66-byte meta-address.

```
RESOLUTION FLOW:
────────────────
1. User enters "alice.dust" (or just "alice")
2. Client strips .dust suffix → "alice"
3. Compute nameHash = keccak256(lowercase("alice"))
4. Query FHENameRegistry.resolveName("alice")
   → Returns (spendingPubKey, viewingPubKey)
5. Construct meta-address: st:eth:0x{spending}{viewing}
6. Proceed with stealth address derivation (Section 4.1)
```

**Resolution Priority (multi-source, fastest wins):**
1. Merkle proof tree (privacy-preserving, cached 5 min)
2. Subgraph query (fast, indexed)
3. Direct on-chain registry call (fallback)

---

## 5. Complete Flow Architectures

### 5.1 SENDING FLOW — Full Privacy Send

```
┌───────────────────────────────────────────────────────────────────────┐
│                    SENDING PRIVACY FLOW                               │
│                                                                       │
│  User: "Send 500 cUSDC to alice.dust"                                │
│                                                                       │
│  STEP 1: NAME RESOLUTION                                             │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ FHENameRegistry.resolveName("alice")                        │     │
│  │   → spendingPubKey (33 bytes, compressed secp256k1)         │     │
│  │   → viewingPubKey  (33 bytes, compressed secp256k1)         │     │
│  │                                                              │     │
│  │ OR: Direct 0x address → ERC-6538 registry lookup            │     │
│  │   → lookupStealthMetaAddress(provider, 0xAddr, schemeId)    │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                            │                                          │
│  STEP 2: STEALTH ADDRESS DERIVATION (client-side, off-chain)        │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ r = randomPrivateKey()          // ephemeral                 │     │
│  │ R = r·G                         // ephemeral public key      │     │
│  │ shared = r·V                    // ECDH with viewing key     │     │
│  │ h = keccak256(shared)           // secret hash               │     │
│  │ viewTag = h[0:1]               // 1-byte fast filter         │     │
│  │ P = S + h·G                    // stealth public key         │     │
│  │ stealthAddr = addr(P)          // stealth address            │     │
│  │                                                              │     │
│  │ IF chain supports EIP-7702:                                  │     │
│  │   → Use stealthAddr directly (EOA with delegated code)      │     │
│  │ ELSE:                                                        │     │
│  │   → Compute CREATE2 account address via factory              │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                            │                                          │
│  STEP 3: ENCRYPT AMOUNT (client-side via @cofhe/sdk)                │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ const [encAmount] = await cofhejs.encrypt([                  │     │
│  │   Encryptable.uint64(500_000000n)  // 500 USDC in 6 dec     │     │
│  │ ]);                                                          │     │
│  │ // Returns InEuint64 { data: ciphertext, signature: zkp }   │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                            │                                          │
│  STEP 4: ON-CHAIN EXECUTION                                         │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ Pre-requisite: Sender has ConfidentialToken balance          │     │
│  │   (deposited USDC → got encrypted cUSDC balance)            │     │
│  │                                                              │     │
│  │ Pre-requisite: Sender approved FHEStealthTransfer contract   │     │
│  │   confidentialToken.approve(stealthTransfer, true)          │     │
│  │                                                              │     │
│  │ tx = FHEStealthTransfer.stealthSend(                        │     │
│  │   stealthAddr,                    // one-time address        │     │
│  │   encAmount,                      // InEuint64 (encrypted)   │     │
│  │   compress(R),                    // ephemeral public key    │     │
│  │   0x{viewTag}{optional_metadata}  // for scanning            │     │
│  │ )                                                            │     │
│  │                                                              │     │
│  │ INSIDE stealthSend():                                        │     │
│  │   euint64 amt = FHE.asEuint64(encAmount);  // validate ZKP  │     │
│  │   _executeConfidentialTransfer(sender, stealthAddr, amt);    │     │
│  │     → FHE.gte(sender_bal, amt) → ebool hasBalance           │     │
│  │     → sender_bal = FHE.select(ok, sub, unchanged)           │     │
│  │     → stealth_bal = FHE.select(ok, add, unchanged)          │     │
│  │     → FHE.allowThis(sender_bal)                              │     │
│  │     → FHE.allow(sender_bal, sender)                          │     │
│  │     → FHE.allowThis(stealth_bal)                             │     │
│  │     → FHE.allow(stealth_bal, stealthAddr)                   │     │
│  │                                                              │     │
│  │   emit StealthTransfer(1, stealthAddr, sender, R, metadata) │     │
│  │   // NOTE: NO AMOUNT in event. That's the point.            │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                       │
│  WHAT AN OBSERVER SEES:                                               │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ ✓ Sender address          (visible — known wallet)           │     │
│  │ ✗ Recipient identity      (hidden — stealth address)         │     │
│  │ ✗ Transfer amount         (hidden — FHE encrypted)           │     │
│  │ ✓ Ephemeral public key    (visible — but useless w/o v)      │     │
│  │ ✓ View tag                (visible — 1 byte, many collide)   │     │
│  │ ✓ A transfer happened     (visible — event emitted)          │     │
│  │ ✗ Whether it succeeded    (hidden — FHE.select is constant)  │     │
│  └─────────────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.2 RECEIVING FLOW — Scan & Discover Payments

```
┌───────────────────────────────────────────────────────────────────────┐
│                    RECEIVING PRIVACY FLOW                             │
│                                                                       │
│  Recipient opens wallet → automatic background scanning              │
│                                                                       │
│  STEP 1: LOAD KEYS                                                   │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ From encrypted IndexedDB (AES-256-GCM, derived from PIN):  │     │
│  │   spendingPrivateKey (s)                                    │     │
│  │   viewingPrivateKey  (v)                                    │     │
│  │   spendingPublicKey  (S)                                    │     │
│  │   viewingPublicKey   (V)                                    │     │
│  │                                                              │     │
│  │ Key derivation: wallet.signMessage("dust-stealth-keys-v2") │     │
│  │   → PBKDF2(signature + PIN, 100K iterations) → entropy     │     │
│  │   → Deterministic key pair generation                       │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                            │                                          │
│  STEP 2: SCAN StealthTransfer EVENTS (background)                   │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ Query FHEStealthTransfer for StealthTransfer events         │     │
│  │ from lastScannedBlock to 'latest'                           │     │
│  │                                                              │     │
│  │ For each event:                                              │     │
│  │   R = event.ephemeralPubKey                                  │     │
│  │   eventViewTag = event.metadata[0:2]                        │     │
│  │                                                              │     │
│  │   // Compute shared secret (recipient side of ECDH)         │     │
│  │   shared = v · R                                             │     │
│  │   h = keccak256(shared)                                      │     │
│  │   myViewTag = h[0:1]                                        │     │
│  │                                                              │     │
│  │   // Fast filter: skip if view tags don't match              │     │
│  │   if (myViewTag ≠ eventViewTag) → skip  // 255/256 filtered │     │
│  │                                                              │     │
│  │   // Full verification                                       │     │
│  │   P = S + h·G                                                │     │
│  │   expectedAddr = addr(P)                                     │     │
│  │   if (expectedAddr ≠ event.stealthAddress) → skip           │     │
│  │                                                              │     │
│  │   // MATCH! This payment is for us.                          │     │
│  │   stealthPrivKey = s + h (mod curve_order)                  │     │
│  │   Store: { stealthAddr, stealthPrivKey, blockNumber, txHash }│     │
│  └─────────────────────────────────────────────────────────────┘     │
│                            │                                          │
│  STEP 3: DECRYPT BALANCE (via CoFHE)                                │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ For each discovered stealth address:                         │     │
│  │                                                              │     │
│  │ encBalance = ConfidentialToken.getEncryptedBalanceOf(        │     │
│  │   stealthAddr                                                │     │
│  │ )                                                            │     │
│  │                                                              │     │
│  │ // Decrypt via CoFHE SDK (threshold decryption network)     │     │
│  │ plainBalance = await cofhejs.decrypt(encBalance)             │     │
│  │ // Only works because FHE.allow(balance, stealthAddr) was   │     │
│  │ // called during the transfer. The stealth private key       │     │
│  │ // holder can authorize decryption.                          │     │
│  │                                                              │     │
│  │ Display: "Received 500.00 cUSDC from unknown sender"        │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                       │
│  WHAT THE RECIPIENT KNOWS:                                           │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ ✓ Someone sent them tokens   (discovered via scan)           │     │
│  │ ✓ Exact amount received      (decrypted via CoFHE)           │     │
│  │ ✓ Stealth private key        (derived, can move funds)       │     │
│  │ ✓ Sender's address           (from event.caller)             │     │
│  │ ✗ Nothing about other users' payments (can't scan others)   │     │
│  └─────────────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.3 WITHDRAWAL FLOW — Claim to Main Wallet

This is the most architecturally challenging part due to FHE's constant-time requirement.

**The Core Problem:** FHE's `FHE.select()` is constant-time — it cannot conditionally execute a plaintext ERC20 transfer. If we do `select` and then unconditionally transfer, the contract drains (see Security Review C-1). We need a 2-step pattern.

```
┌───────────────────────────────────────────────────────────────────────┐
│              WITHDRAWAL PRIVACY FLOW (2-Step Pattern)                │
│                                                                       │
│  APPROACH A: STEALTH-TO-STEALTH CONSOLIDATION (Wave 1)              │
│  ════════════════════════════════════════════════════════             │
│  Keep everything in the encrypted domain. Move encrypted             │
│  balance from stealth address to recipient's main cUSDC balance.    │
│                                                                       │
│  STEP 1: GAS SPONSORSHIP                                            │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ POST /api/fhe/sponsor-claim-gas                              │     │
│  │   body: { stealthAddress }                                   │     │
│  │                                                              │     │
│  │ Relayer sends a small amount of ETH to stealthAddress        │     │
│  │ so it can pay for the claim transaction's gas.               │     │
│  │                                                              │     │
│  │ PRIVACY NOTE: The relayer sees the stealth address but       │     │
│  │ does NOT know who owns it or how much is there.              │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                            │                                          │
│  STEP 2: ENCRYPT KNOWN AMOUNT                                       │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ // Recipient already knows the plaintext amount (from scan) │     │
│  │ const [encAmount] = await cofhejs.encrypt([                  │     │
│  │   Encryptable.uint64(knownPlaintextAmount)                   │     │
│  │ ]);                                                          │     │
│  │                                                              │     │
│  │ WHY RE-ENCRYPT? The contract needs a fresh InEuint64 input   │     │
│  │ with a valid ZKP. We can't reuse the stored euint64 handle  │     │
│  │ because confidentialTransfer() expects client-encrypted input.│     │
│  └─────────────────────────────────────────────────────────────┘     │
│                            │                                          │
│  STEP 3: TRANSFER FROM STEALTH → MAIN WALLET                       │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ // Sign with stealth private key (derived during scan)      │     │
│  │ const stealthWallet = new Wallet(stealthPrivKey, provider);  │     │
│  │                                                              │     │
│  │ tx = ConfidentialToken.confidentialTransfer(                 │     │
│  │   mainWalletAddress,  // recipient's real address            │     │
│  │   encAmount           // encrypted claim amount              │     │
│  │ )                                                            │     │
│  │ // Called FROM the stealth address (msg.sender = stealthAddr)│     │
│  │                                                              │     │
│  │ INSIDE confidentialTransfer():                               │     │
│  │   sender = stealthAddr (msg.sender)                          │     │
│  │   recipient = mainWalletAddress                              │     │
│  │   → FHE.select deducts from stealth, adds to main           │     │
│  │   → Both parties' FHE.allow() are set                        │     │
│  │   → emit ConfidentialTransfer(stealth, main)                 │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                       │
│  PRIVACY CONSIDERATION:                                              │
│  The on-chain event ConfidentialTransfer(stealthAddr, mainAddr)     │
│  reveals a link between the stealth address and the main wallet.     │
│  This is acceptable for Wave 1 but degraded privacy.                 │
│                                                                       │
│  ═══════════════════════════════════════════════════════════════      │
│                                                                       │
│  APPROACH B: FHE PRIVACY POOL (Wave 2 — Full Withdrawal Privacy)   │
│  ════════════════════════════════════════════════════════             │
│  Break the stealth→main link using an FHE-native pool.              │
│  See Section 8 for full design.                                      │
│                                                                       │
│  STEP 1: Deposit encrypted balance into FHE Pool                    │
│  STEP 2: Wait (anonymity set grows)                                 │
│  STEP 3: Async decryption callback → reveal amount                  │
│  STEP 4: Withdraw plaintext tokens to any address                   │
│  STEP 5: No on-chain link between deposit address and               │
│           withdrawal address                                          │
│                                                                       │
│  APPROACH C: 2-STEP REVEAL-THEN-CLAIM (Wave 2 Alternative)         │
│  ════════════════════════════════════════════════════════             │
│  Uses FHE async decryption callbacks to safely unwrap to ERC20.     │
│                                                                       │
│  STEP 1: Request decryption                                         │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ User calls ConfidentialToken.requestWithdraw(encAmount)      │     │
│  │   → FHE.sub(balance, encAmount)  // encrypted deduction     │     │
│  │   → FHE.requestDecryption(encAmount, onWithdrawCallback)    │     │
│  │   → Store pending withdrawal: { user, requestId }            │     │
│  │   → NO tokens move yet                                       │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                            │                                          │
│  STEP 2: Async callback (CoFHE threshold network decrypts)         │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ function onWithdrawCallback(                                 │     │
│  │   uint256 requestId,                                         │     │
│  │   bytes calldata cleartexts,                                 │     │
│  │   bytes calldata decryptionProof                             │     │
│  │ ) {                                                          │     │
│  │   FHE.checkSignatures(decryptionProof);  // verify MPC sigs │     │
│  │   require(pendingWithdrawals[requestId].valid);              │     │
│  │   uint64 amount = abi.decode(cleartexts, (uint64));          │     │
│  │   address user = pendingWithdrawals[requestId].user;         │     │
│  │   delete pendingWithdrawals[requestId];  // replay protect   │     │
│  │   IERC20(underlying).safeTransfer(user, amount);             │     │
│  │   totalWrapped -= amount;                                    │     │
│  │ }                                                            │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                       │
│  This 2-step pattern is SAFE because:                                │
│  - The encrypted deduction happens first (Step 1)                   │
│  - The plaintext transfer only happens in the callback (Step 2)     │
│  - The callback is triggered by the CoFHE network, not the user     │
│  - Replay protection via requestId prevents double-claim            │
│  - FHE.checkSignatures() verifies MPC threshold signatures          │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.4 AMOUNT PRIVACY — End-to-End Encrypted Lifecycle

```
┌───────────────────────────────────────────────────────────────────────┐
│                    AMOUNT PRIVACY LIFECYCLE                           │
│                                                                       │
│  PHASE 1: DEPOSIT (Privacy begins)                                   │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ User deposits 1000 USDC into ConfidentialToken               │     │
│  │                                                              │     │
│  │ ON-CHAIN (visible):                                          │     │
│  │   ERC20.transferFrom(user, contract, 1000e6) ← VISIBLE      │     │
│  │   emit Deposited(user, 1000e6) ← VISIBLE                    │     │
│  │                                                              │     │
│  │ ON-CHAIN (encrypted):                                        │     │
│  │   balance[user] = FHE.add(balance[user], FHE.asEuint64(1e9))│     │
│  │   // balance is now euint64 — encrypted, never visible       │     │
│  │                                                              │     │
│  │ PRIVACY WEAKNESS: Deposit amount is public.                  │     │
│  │ MITIGATION: Batch deposits from multiple users (Wave 2)      │     │
│  │   or deposit into privacy pool first.                        │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                            │                                          │
│  PHASE 2: TRANSFER (Full privacy)                                   │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ FHEStealthTransfer.stealthSend(stealth, encAmt, R, viewTag) │     │
│  │                                                              │     │
│  │ ON-CHAIN (visible):                                          │     │
│  │   emit StealthTransfer(1, stealth, sender, R, viewTag)      │     │
│  │   // NO amount in event. NO link to recipient identity.      │     │
│  │                                                              │     │
│  │ ON-CHAIN (encrypted):                                        │     │
│  │   balance[sender]  -= encAmt (FHE arithmetic)               │     │
│  │   balance[stealth] += encAmt (FHE arithmetic)               │     │
│  │   // Both paths execute regardless of sufficiency            │     │
│  │   // (constant-time via FHE.select)                          │     │
│  │                                                              │     │
│  │ PRIVACY: MAXIMUM. Amount hidden, recipient hidden,           │     │
│  │   success/failure hidden.                                    │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                            │                                          │
│  PHASE 3: CLAIM (Some privacy trade-off)                            │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ Wave 1 (stealth→main encrypted transfer):                    │     │
│  │   Amount stays encrypted. Link between stealth and main      │     │
│  │   address is visible. No plaintext amount leaked.            │     │
│  │                                                              │     │
│  │ Wave 2 (FHE Pool or 2-step reveal):                          │     │
│  │   Amount decrypted only in callback. Link between            │     │
│  │   stealth deposit and main withdrawal is broken.             │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                            │                                          │
│  PHASE 4: WITHDRAWAL (Privacy exits)                                │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ Unwrap cUSDC → USDC                                          │     │
│  │ Amount becomes public again (ERC20 transfer is visible)      │     │
│  │                                                              │     │
│  │ PRIVACY: The withdrawal amount is visible, but if using      │     │
│  │ the pool approach, the LINK to who deposited is broken.      │     │
│  │ Observer sees "someone withdrew 1000 USDC" but not who       │     │
│  │ deposited it.                                                │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │               AMOUNT VISIBILITY TIMELINE                     │     │
│  │                                                              │     │
│  │  Deposit ──► Encrypted ──► Transfer ──► Claim ──► Withdraw  │     │
│  │  VISIBLE     HIDDEN        HIDDEN       HIDDEN    VISIBLE   │     │
│  │                                                              │     │
│  │  Privacy Window: ═══════════════════════════                 │     │
│  │  (all operations within window are amount-private)           │     │
│  └─────────────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 6. Smart Contract Architecture

### 6.1 Contract Dependency Graph

```
                    ┌───────────────────────┐
                    │   FHENameRegistry     │
                    │                       │
                    │ .dust name → meta-addr│
                    │ (spending + viewing   │
                    │  public keys)         │
                    └───────────┬───────────┘
                                │ resolveName()
                                ▼
┌──────────────────┐   ┌───────────────────────┐   ┌──────────────────┐
│  ConfidentialToken│◄──│  FHEStealthTransfer   │   │  FHEPrivacyPool  │
│                  │   │                       │   │  (Wave 2)        │
│  deposit()       │   │  stealthSend()        │   │                  │
│  confidential    │   │  stealthSendNative()  │   │  deposit()       │
│   Transfer()     │   │  batchStealthSend()   │   │  requestWithdraw │
│  getEncBalance() │   │                       │   │  onCallback()    │
│                  │   │  emits StealthTransfer│   │  withdraw()      │
│  euint64 balance │   │  event (ERC-5564)     │   │                  │
└──────────────────┘   └───────────────────────┘   └──────────────────┘
         │                       │                          │
         └───────────────────────┼──────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Fhenix CoFHE Runtime  │
                    │                         │
                    │  FHE.asEuint64()        │
                    │  FHE.add() / .sub()     │
                    │  FHE.gte() / .select()  │
                    │  FHE.allow()            │
                    │  FHE.allowThis()        │
                    │  FHE.requestDecryption()│
                    └─────────────────────────┘
```

### 6.2 Contract: ConfidentialToken.sol (Existing — Needs Wave 2 Upgrade)

**Current State:** Handles deposit + encrypted transfer. Withdraw removed due to C-1 drain vulnerability.

**Wave 2 Addition — Safe Withdrawal:**

```solidity
// NEW: 2-step withdrawal with async decryption callback

struct PendingWithdrawal {
    address user;
    address recipient;     // Can differ from user (privacy: withdraw to different addr)
    uint64  amount;        // Filled by callback
    bool    pending;
    uint256 requestedAt;
}

mapping(uint256 => PendingWithdrawal) public pendingWithdrawals;
uint256 public nextWithdrawalId;

/// @notice Step 1: Request withdrawal. Encrypted balance deducted immediately.
///         Tokens released only when CoFHE callback confirms decryption.
function requestWithdraw(
    InEuint64 calldata encAmount,
    address recipient           // Can be different address for privacy
) external whenNotPaused nonReentrant returns (uint256 requestId) {
    if (recipient == address(0)) revert ZeroAddress();

    euint64 amount = FHE.asEuint64(encAmount);

    // Deduct from encrypted balance (constant-time)
    ebool hasBalance = FHE.gte(_balances[msg.sender], amount);
    _balances[msg.sender] = FHE.select(
        hasBalance,
        FHE.sub(_balances[msg.sender], amount),
        _balances[msg.sender]
    );
    FHE.allowThis(_balances[msg.sender]);
    FHE.allow(_balances[msg.sender], msg.sender);

    // Request async decryption
    requestId = nextWithdrawalId++;
    pendingWithdrawals[requestId] = PendingWithdrawal({
        user: msg.sender,
        recipient: recipient,
        amount: 0,
        pending: true,
        requestedAt: block.timestamp
    });

    // FHE.requestDecryption triggers threshold network
    FHE.requestDecryption(amount, this.onWithdrawCallback.selector);

    emit WithdrawalRequested(requestId, msg.sender, recipient);
}

/// @notice Step 2: Callback from CoFHE threshold network with decrypted amount.
function onWithdrawCallback(
    uint256 requestId,
    bytes calldata cleartexts,
    bytes calldata decryptionProof
) external {
    // Verify CoFHE MPC signatures
    FHE.checkSignatures(decryptionProof);

    PendingWithdrawal storage pw = pendingWithdrawals[requestId];
    require(pw.pending, "Invalid or already processed");

    uint64 amount = abi.decode(cleartexts, (uint64));

    // If amount is 0, the FHE.select kept balance unchanged (insufficient)
    // No tokens to release
    if (amount > 0) {
        pw.amount = amount;
        totalWrapped -= amount;
        IERC20(underlyingToken).safeTransfer(pw.recipient, amount);
    }

    pw.pending = false;
    emit WithdrawalCompleted(requestId, pw.recipient, amount);
}
```

### 6.3 Contract: FHEStealthTransfer.sol (Existing — Core Send)

**No changes needed for Wave 1.** The existing contract correctly:
- Takes encrypted amount (`InEuint64`) from client
- Calls `confidentialTransferFrom` on the wrapped token
- Emits `StealthTransfer` event with NO amount (only ephemeral key + view tag)
- Supports batch sends for payroll

### 6.4 Contract: FHENameRegistry.sol (Existing — Name Resolution)

**Recommended improvements:**

1. **Add name deactivation** (from Security Review M-2):
```solidity
function deactivateName(string calldata name) external {
    bytes32 nameHash = keccak256(abi.encodePacked(_toLowerCase(name)));
    if (nameOwners[nameHash] != msg.sender) revert NotNameOwner(nameHash, msg.sender);
    registry[nameHash].active = false;
    emit NameDeactivated(nameHash);
}
```

2. **Require new keys on transfer** (from Security Review M-3):
```solidity
function transferName(
    string calldata name,
    address newOwner,
    bytes calldata newSpendingPubKey,
    bytes calldata newViewingPubKey
) external { ... }
```

### 6.5 NEW Contract: FHEPrivacyPool.sol (Wave 2 — Full Withdrawal Privacy)

**Purpose:** Break the deposit→withdrawal address link. Users deposit encrypted tokens from stealth addresses and withdraw to any address, with no on-chain correlation.

```solidity
/// @title FHEPrivacyPool
/// @notice FHE-native privacy pool. Unlike ZK-UTXO pools (DustPool),
///         this uses FHE encrypted state directly — no Merkle trees,
///         no commitment hashes, no nullifiers. CoFHE handles everything.
contract FHEPrivacyPool {

    struct PoolDeposit {
        euint64 encryptedAmount;
        address depositor;        // stealth address (one-time)
        uint256 depositedAt;
        bool    withdrawn;
    }

    uint256 public nextDepositId;
    mapping(uint256 => PoolDeposit) private deposits;

    // Encrypted running total for solvency
    euint64 public encryptedPoolBalance;

    uint256 public constant MIN_DEPOSIT_DELAY = 1 hours;

    /// @notice Deposit encrypted tokens into the pool
    function deposit(InEuint64 calldata encAmount) external {
        euint64 amount = FHE.asEuint64(encAmount);

        // Transfer from sender to pool
        token.confidentialTransferFrom(msg.sender, address(this), encAmount);

        uint256 id = nextDepositId++;
        deposits[id] = PoolDeposit({
            encryptedAmount: amount,
            depositor: msg.sender,
            depositedAt: block.timestamp,
            withdrawn: false
        });

        encryptedPoolBalance = FHE.add(encryptedPoolBalance, amount);
        FHE.allowThis(encryptedPoolBalance);

        emit PoolDeposit(id, msg.sender);  // NO amount
    }

    /// @notice Request withdrawal to any address (breaks link)
    /// @param depositId The deposit to withdraw
    /// @param recipient ANY address (does not need to match depositor)
    function requestWithdraw(
        uint256 depositId,
        address recipient,
        bytes calldata ownershipProof  // Proves caller controls depositId
    ) external {
        PoolDeposit storage d = deposits[depositId];
        require(!d.withdrawn, "Already withdrawn");
        require(block.timestamp >= d.depositedAt + MIN_DEPOSIT_DELAY, "Too early");

        // Verify ownership (caller must prove they control the stealth key)
        // This could use a signature from the stealth address
        require(verifyOwnership(d.depositor, ownershipProof), "Not owner");

        d.withdrawn = true;

        // Request decryption of the deposit amount
        FHE.requestDecryption(d.encryptedAmount, this.onPoolWithdrawCallback.selector);
        // Store recipient for callback
        pendingPoolWithdrawals[currentRequestId] = recipient;
    }

    function onPoolWithdrawCallback(
        uint256 requestId,
        bytes calldata cleartexts,
        bytes calldata decryptionProof
    ) external {
        FHE.checkSignatures(decryptionProof);
        uint64 amount = abi.decode(cleartexts, (uint64));
        address recipient = pendingPoolWithdrawals[requestId];

        if (amount > 0) {
            // Transfer plaintext tokens to recipient
            IERC20(underlying).safeTransfer(recipient, amount);
        }

        emit PoolWithdrawal(recipient, amount);
        // NOTE: Event links recipient + amount, but NOT the original depositor
    }
}
```

**Why FHE Pool > ZK-UTXO Pool:**

| Property | ZK-UTXO (DustPool) | FHE Pool |
|----------|-------------------|----------|
| Proof system | FFLONK / Groth16 circuits | No proofs needed — FHE handles state |
| Client complexity | Snarkjs proving (~2-5 sec) | CoFHE encrypt (~100ms) |
| On-chain state | Merkle tree + nullifier set | Encrypted balances only |
| Amount hiding | Commitment hash (hidden) | FHE encrypted (hidden) |
| Trusted setup | Needed for Groth16 | Not needed |
| Compliance | ZK exclusion proofs (complex) | Can check against sanctions via FHE comparison |

---

## 7. Client Architecture

### 7.1 Hook Dependency Graph

```
┌──────────────────────────────────────────────────┐
│                  UI Components                    │
│                                                    │
│  SendModal ─── PayPageClient ─── DashboardBalance │
│      │              │                  │           │
│      └──────┬───────┘                  │           │
│             │                          │           │
│      ┌──────▼───────┐    ┌─────────────▼─────┐   │
│      │useFHEStealth │    │  useFHEBalance     │   │
│      │   Send       │    │                    │   │
│      │              │    │  cofheReadContract │   │
│      │  encrypt()   │    │  AndDecrypt()      │   │
│      │  stealthSend │    │                    │   │
│      └──────┬───────┘    └────────────────────┘   │
│             │                                      │
│      ┌──────▼───────┐    ┌────────────────────┐   │
│      │useFHEStealth │    │ useFHEStealth      │   │
│      │   Claim      │    │   Scanner          │   │
│      │              │    │                    │   │
│      │  sponsorGas  │    │  scanFHEStealth    │   │
│      │  encrypt()   │    │  Transfers()       │   │
│      │  transfer()  │    │  ECDH matching     │   │
│      └──────────────┘    └────────────────────┘   │
│                                                    │
│  ┌───────────────────────────────────────────┐    │
│  │          Shared Dependencies               │    │
│  │                                            │    │
│  │  @cofhe/sdk ── encrypt, decrypt            │    │
│  │  @cofhe/react ── useCofheEncrypt, etc.     │    │
│  │  @noble/secp256k1 ── ECDH derivation       │    │
│  │  wagmi/viem ── wallet, provider            │    │
│  │  AuthContext ── stealth keys, PIN, names    │    │
│  └───────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

### 7.2 Recipient Input — Supporting Both 0x and .dust

The input field needs to support both `.dust` names and raw `0x` addresses with a clean UX:

```
┌─────────────────────────────────────────────────────────────────┐
│  RECIPIENT INPUT DESIGN                                          │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ RECIPIENT                                                 │   │
│  │ ┌──────────────────────────────────────┬────────┬───────┐│   │
│  │ │ alice                                │ .dust  │  PAY  ││   │
│  │ └──────────────────────────────────────┴────────┴───────┘│   │
│  │                                                           │   │
│  │ BEHAVIOR:                                                 │   │
│  │  • Default mode: Type name, ".dust" suffix shown fixed    │   │
│  │  • If input starts with "0x": hide ".dust" suffix,        │   │
│  │    show full address input mode                           │   │
│  │  • Live validation with debounce (300ms)                  │   │
│  │  • Green checkmark when resolved                          │   │
│  │  • Red error when name not found                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  RESOLUTION LOGIC:                                               │
│                                                                   │
│  function resolveRecipient(input: string) {                      │
│    input = input.trim().toLowerCase();                           │
│                                                                   │
│    // Mode 1: Raw 0x address                                     │
│    if (input.startsWith("0x") && input.length === 42) {          │
│      // Look up in ERC-6538 stealth meta-address registry        │
│      meta = await lookupStealthMetaAddress(provider, input);     │
│      if (!meta) throw "Address not registered for stealth";      │
│      return meta;                                                │
│    }                                                              │
│                                                                   │
│    // Mode 2: .dust name                                         │
│    let name = input.endsWith(".dust")                            │
│      ? input.slice(0, -5) : input;                               │
│                                                                   │
│    // Support "link.username" format                              │
│    const parts = name.split(".");                                │
│    if (parts.length > 1) {                                       │
│      linkSlug = parts[0];                                        │
│      name = parts[parts.length - 1];                             │
│    }                                                              │
│                                                                   │
│    // Resolve via FHENameRegistry or legacy StealthNameRegistry  │
│    const { spendingPubKey, viewingPubKey } =                     │
│      await nameRegistry.resolveName(name);                       │
│    return constructMetaAddress(spendingPubKey, viewingPubKey);   │
│  }                                                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Wave 2: FHE Privacy Pool — Full Design

### 8.1 Why We Need It

Wave 1 has a privacy leak at claim time: when the recipient claims from stealth address → main wallet, the `ConfidentialTransfer(stealth, main)` event links the two. An observer who sees the send event and the claim event can correlate them.

The FHE Privacy Pool breaks this link completely.

### 8.2 Pool Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                FHE PRIVACY POOL ARCHITECTURE                      │
│                                                                    │
│  DEPOSIT SIDE                    │    WITHDRAWAL SIDE             │
│  (stealth addresses)             │    (any address)               │
│                                  │                                 │
│  stealth_1 ──┐                   │                ┌── wallet_A    │
│  stealth_2 ──┤                   │                ├── wallet_B    │
│  stealth_3 ──┼── FHEPrivacyPool ─┼─ time delay ──┼── wallet_C    │
│  stealth_4 ──┤   (encrypted      │                ├── wallet_D    │
│  stealth_5 ──┘    balances)      │                └── wallet_E    │
│                                  │                                 │
│  ON-CHAIN VISIBLE:               │    ON-CHAIN VISIBLE:           │
│  • stealth_N deposited           │    • wallet_X withdrew         │
│  • deposit timestamp             │    • withdrawal amount         │
│  • NO amount (FHE encrypted)     │    • withdrawal timestamp      │
│                                  │                                 │
│  CANNOT LINK:                    │                                 │
│  stealth_3 ←──── ? ────→ wallet_B                                │
│  (which deposit funded which withdrawal is unknowable)            │
│                                                                    │
│  PRIVACY PROPERTIES:                                              │
│  • Anonymity set = all deposits in pool                           │
│  • Deposit amounts hidden (FHE)                                   │
│  • Withdrawal amount visible (plaintext ERC20) but unlinkable    │
│  • Time delay prevents timing correlation                        │
│  • Multiple deposits/withdrawals of different amounts add noise  │
└──────────────────────────────────────────────────────────────────┘
```

### 8.3 Compliance Layer (Optional)

For regulatory compliance without sacrificing privacy:

```
┌──────────────────────────────────────────────────────────────────┐
│                    COMPLIANCE INTEGRATION                         │
│                                                                    │
│  OPTION A: Encrypted Sanctions Check (FHE-native)                │
│  ┌──────────────────────────────────────────────────────┐        │
│  │ // Store sanctions list as encrypted addresses       │        │
│  │ mapping(uint256 => eaddress) sanctionsList;          │        │
│  │                                                      │        │
│  │ // Check depositor NOT on sanctions list             │        │
│  │ for each sanctioned in list:                         │        │
│  │   ebool match = FHE.eq(depositorEnc, sanctioned);    │        │
│  │   ebool notSanctioned = FHE.not(match);              │        │
│  │   // Constant-time: no information leakage           │        │
│  │                                                      │        │
│  │ ADVANTAGE: Sanctions check happens on encrypted data │        │
│  │ Nobody learns WHO was checked or the result          │        │
│  └──────────────────────────────────────────────────────┘        │
│                                                                    │
│  OPTION B: Deposit Screening (existing pattern)                  │
│  ┌──────────────────────────────────────────────────────┐        │
│  │ // Use Chainalysis oracle (same as DustPool V2)      │        │
│  │ require(!chainalysis.isSanctioned(msg.sender));      │        │
│  │ // Works but reveals the depositor address on-chain  │        │
│  └──────────────────────────────────────────────────────┘        │
│                                                                    │
│  OPTION C: Selective Disclosure (future)                         │
│  ┌──────────────────────────────────────────────────────┐        │
│  │ // User generates a "compliance proof" off-chain     │        │
│  │ // Proves: "I am NOT on sanctions list AND           │        │
│  │ //         my deposit source is compliant"           │        │
│  │ // Without revealing identity or amount              │        │
│  │ // Uses FHE permits + auditor access grants          │        │
│  └──────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 9. Gas & Performance Analysis

### 9.1 FHE Operation Costs

| Operation | Plain EVM Gas | FHE Gas (euint64) | Ratio |
|-----------|--------------|-------------------|-------|
| Addition | ~3 | ~188,000 | ~63,000x |
| Subtraction | ~3 | ~188,000 | ~63,000x |
| Comparison (gte) | ~3 | ~200,000 | ~67,000x |
| Select (ternary) | ~5 | ~210,000 | ~42,000x |
| asEuint64 (validate) | N/A | ~150,000 | N/A |
| allow | N/A | ~50,000 | N/A |
| allowThis | N/A | ~50,000 | N/A |

**Full stealthSend() estimated gas:**
- asEuint64 (validate ZKP): ~150K
- gte (balance check): ~200K
- sub (sender deduct): ~188K
- add (recipient credit): ~188K
- 2x select (constant-time): ~420K
- 4x allow/allowThis: ~200K
- Event emission: ~5K
- Total: ~1.35M gas

**On Arbitrum Sepolia:** ~$0.01-0.05 per stealth send (L2 gas is cheap).

### 9.2 Optimization Strategies

1. **Use smallest FHE type possible:** euint32 for amounts < 4.29B base units (most stablecoins fit)
2. **Batch operations:** `batchStealthSend` amortizes per-tx overhead
3. **Lazy allowThis:** Only call after final mutation (not intermediate steps)
4. **Off-chain scanning:** All scan operations are off-chain (no gas)
5. **Sponsored announcements:** Relayer pays announcement gas

---

## 10. Security Considerations

### 10.1 Addressed Vulnerabilities

| ID | Severity | Issue | Resolution |
|----|----------|-------|-----------|
| C-1 | Critical | Withdraw drain (unconditional ERC20 transfer after FHE.select) | Remove withdraw() in Wave 1. Add 2-step async pattern in Wave 2. |
| H-1 | High | Deposit amount mismatch (client provides both plain + encrypted) | Compute encrypted value on-chain from plaintext: `FHE.asEuint64(uint256(amount))` |
| H-2 | High | Boolean approval (unlimited transferFrom) | Acceptable for Wave 1 (contract-level approval). Wave 2: encrypted allowance. |
| M-1 | Medium | Deposit/withdraw events leak exact amounts | Wave 2: batch deposits via pool, break correlation |
| M-3 | Medium | Name transfer doesn't update keys | Require new keys as parameter to transferName() |

### 10.2 FHE-Specific Security

| Risk | Mitigation |
|------|-----------|
| Coprocessor compromise | Threshold decryption (MPC) — no single party can decrypt |
| Replay decryption proofs | requestId tracking, delete after use |
| Balance leakage via gas | Constant-time FHE.select — same gas regardless of outcome |
| Stale FHE handles | FHE.allowThis() on every mutation |
| Client-side encryption tampering | ZKP validation via FHE.asEuint64(InEuint64) |

### 10.3 Stealth Address Security

| Risk | Mitigation |
|------|-----------|
| Viewing key leak | Only exposes read access, not spending capability |
| Ephemeral key reuse | New random key per payment (enforced client-side) |
| View tag collision | Only 1/256 filter rate — full ECDH verification follows |
| PIN brute-force | PBKDF2 with 100K iterations on key derivation |

---

## 11. Deployment Architecture

### 11.1 Chain Selection

| Chain | Role | Why |
|-------|------|-----|
| **Arbitrum Sepolia** | Primary FHE chain | CoFHE coprocessor live, L2 gas costs |
| **Base Sepolia** | Secondary FHE chain | Broader ecosystem, alternative deployment |

### 11.2 Contract Deployment Order

```
1. MockUSDC (or use existing testnet USDC)
2. ConfidentialToken(mockUSDC, deployer)
3. FHEStealthTransfer(confidentialToken, deployer)
4. FHENameRegistry(registrationFee=0)
5. ConfidentialToken.approve(fheStealthTransfer, true)  ← deployer approves
```

### 11.3 Infrastructure

```
┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐
│  Next.js App │    │   Relayer    │    │  Fhenix CoFHE        │
│  (Vercel)    │    │  (Railway)   │    │  Coprocessor         │
│              │    │              │    │  (Fhenix-hosted)     │
│  Frontend +  │───►│  Gas sponsor │    │                      │
│  API routes  │    │  Announce tx │    │  Threshold network   │
│              │    │  Name reg tx │    │  Decryption MPC      │
└──────────────┘    └──────────────┘    └──────────────────────┘
       │                    │                      │
       └────────────────────┼──────────────────────┘
                            │
                   Arbitrum Sepolia RPC
```

---

## 12. UI/UX: The .dust Input Issue

### Current Problem

Based on the screenshot, when clicking the `.dust` recipient input area, the dropdown or input doesn't open/focus properly. The root cause is in the `PayPageClient.tsx` component where the chain/token selector dropdowns use a `mousedown` event listener pattern that can conflict with input focus.

### Recommended Fix

```typescript
// CURRENT (buggy): mousedown listener can steal focus
useEffect(() => {
  const handler = (e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node))
      setOpen(false);
  };
  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
}, []);

// FIX: Use focusout/blur events instead, and ensure input gets focus
// Also: add explicit onClick handler on the input container
```

The input should:
1. Auto-focus on page load or container click
2. Show `.dust` as a non-editable suffix badge (not part of the input value)
3. Detect `0x` prefix to switch to address mode (hide `.dust` suffix)
4. Show resolution status inline (spinner, checkmark, error)

---

## 13. Buildathon Submission Strategy

### Wave 1 (Due Mar 28): FHE Stealth Transfers

**Deliverables:**
- ConfidentialToken.sol — FHE-wrapped ERC20 with encrypted balances
- FHEStealthTransfer.sol — Encrypted stealth send with ERC-5564 announcements
- FHENameRegistry.sol — .dust name resolution
- Frontend: Pay page with encrypted amount, receive page with scan + claim
- 69 passing tests across 3 contract suites

**What Judges See:**
- Send to `alice.dust` → amount is encrypted on-chain (never visible)
- Recipient scans, discovers payment, decrypts amount client-side
- Claims to main wallet in encrypted domain

### Wave 2 (Due Apr 6): FHE Privacy Pool

**Deliverables:**
- FHEPrivacyPool.sol — Encrypted deposit/withdraw with async decryption
- ConfidentialToken upgrade — Safe 2-step withdrawal pattern
- Compliance layer — FHE-native sanctions checking
- Frontend: Pool deposit/withdraw UI with progress tracking

### Key Differentiators

1. **First stealth + FHE combination on EVM** — Novel architecture, not a fork
2. **Complete privacy stack** — WHO (stealth) + HOW MUCH (FHE) + LINK (pool)
3. **Production patterns** — Constant-time operations, security review, 2-step withdrawal
4. **Human-readable** — .dust names instead of cryptographic addresses
5. **Composable** — ConfidentialToken can integrate with any DeFi protocol that supports FHE

---

## 14. Future Architecture (Waves 3-5)

### Encrypted DeFi Primitives

```
Wave 3: FHE Prediction Markets
  → Encrypted bets, sealed outcomes, MEV-free settlement

Wave 3: FHE Limit Orders
  → Encrypted order book, no front-running possible

Wave 4: Cross-chain FHE
  → Bridge encrypted balances between CoFHE-enabled chains

Wave 5: Mainnet
  → Arbitrum mainnet deployment
  → Formal verification of FHE patterns
  → Institutional-grade compliance (selective disclosure)
```

---

## Appendix A: Complete Data Flow Diagram

```
                              DUST FHE STEALTH WALLET
                              ════════════════════════

    SENDER                          CHAIN                         RECIPIENT
    ══════                          ═════                         ═════════

 1. Enter "alice.dust"
    + amount (500 USDC)
           │
 2. Resolve name ──────────►  FHENameRegistry
           │                  .resolveName("alice")
           │                         │
           │  ◄── (spending, viewing pubkeys)
           │
 3. ECDH derivation
    (ephemeral key r)
    shared = r·V
    stealthAddr = addr(S + h·G)
           │
 4. cofhejs.encrypt(500e6)
    → InEuint64 (ciphertext + ZKP)
           │
 5. Submit tx ─────────────►  FHEStealthTransfer
           │                  .stealthSend(
           │                    stealthAddr,
           │                    encAmount,
           │                    R,
           │                    viewTag
           │                  )
           │                         │
           │                  ┌──────▼──────────────────┐
           │                  │ CoFHE Coprocessor        │
           │                  │                          │
           │                  │ validate ZKP             │
           │                  │ sender -= enc(500)       │
           │                  │ stealth += enc(500)      │
           │                  │ (all on ciphertexts)     │
           │                  └──────┬──────────────────┘
           │                         │
           │                  emit StealthTransfer(
           │                    stealthAddr, sender,
           │                    R, viewTag
           │                  )  ← NO AMOUNT
           │                                              │
           │                                    6. Background scan
           │                                       shared' = v·R
           │                                       h' = keccak256(shared')
           │                                       check viewTag
           │                                       verify stealthAddr
           │                                              │
           │                                    7. MATCH! Derive
           │                                       stealthPrivKey = s + h
           │                                              │
           │                                    8. cofhejs.decrypt(
           │                                       stealthBalance)
           │                                       → 500.00 cUSDC
           │                                              │
           │                                    9. Claim: transfer
           │                                       stealth → main wallet
           │                                       (encrypted domain)
           │                                              │
           │                                    10. (Wave 2) Pool withdraw
           │                                        → plaintext USDC
           │                                        → any address
           │                                        → link broken
```

---

## Appendix B: Key File Locations

| Component | File Path |
|-----------|-----------|
| ConfidentialToken | `contracts/fhe-stealth/contracts/ConfidentialToken.sol` |
| FHEStealthTransfer | `contracts/fhe-stealth/contracts/FHEStealthTransfer.sol` |
| FHENameRegistry | `contracts/fhe-stealth/contracts/FHENameRegistry.sol` |
| FHE Send Hook | `src/hooks/fhe/useFHEStealthSend.ts` |
| FHE Claim Hook | `src/hooks/fhe/useFHEStealthClaim.ts` |
| FHE Balance Hook | `src/hooks/fhe/useFHEBalance.ts` |
| FHE Scanner | `src/lib/fhe/scanner.ts` |
| Stealth Address Derivation | `src/lib/stealth/address.ts` |
| Key Management | `src/lib/stealth/keys.ts` |
| Name Resolution | `src/lib/stealth/names.ts` |
| Pay Page UI | `src/app/pay/[name]/PayPageClient.tsx` |
| FHE Pay Page | `src/app/fhe/pay/[name]/FHEPayPageClient.tsx` |
| Send Modal | `src/components/send/SendModal.tsx` |
| Auth Context | `src/contexts/AuthContext.tsx` |
| FHE Contract Config | `src/lib/fhe/contracts.ts` |
| Hardhat Config (FHE) | `contracts/fhe-stealth/hardhat.config.ts` |
| Deployment Script | `contracts/fhe-stealth/scripts/deploy-all.ts` |
