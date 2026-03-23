# Research Notes: Fhenix Buildathon

## Source 1: Existing Codebase (dust-fhe)

### Architecture
- **Framework**: Next.js 14, React 18, TypeScript
- **Auth**: Privy (@privy-io/react-auth + @privy-io/wagmi)
- **Web3**: viem 2.44, wagmi 2.14, ethers 5.7
- **ZK**: snarkjs 0.7, circomlibjs 0.1, circom 2.1 circuits
- **Crypto**: @noble/hashes, @noble/secp256k1, elliptic, bn.js
- **Testing**: vitest, @playwright/test, fake-indexeddb

### Smart Contracts
- `DustPoolV2.sol` — ZK-UTXO privacy pool (2-in-2-out, 2-in-8-out split)
  - FFLONK proofs, off-chain Merkle tree, relayer architecture
  - Compliance oracle, exclusion proofs, cooldown period
  - Token whitelist, solvency tracking, batch deposits
- `DustSwapHook.sol` — Uniswap V4 hook for private swaps
  - beforeSwap proof validation, afterSwap stealth routing
  - Relayer fee system (max 5%, BPS denominator)
  - Pending swap state between hook callbacks
- `ERC5564Announcer.sol` / `ERC6538Registry.sol` — Stealth address standards
- `StealthNameRegistry.sol` — .dust name system
- `StealthRelayer.sol` — Gasless claim relayer

### Circuits (Circom)
- `DustV2Transaction.circom` — Universal 2-in-2-out privacy tx
  - Merkle proof verifier (Poseidon hashing)
  - Commitment = Poseidon(owner, amount, asset, chainId, blinding)
  - Nullifier = Poseidon(nullifierKey, commitment, leafIndex)
  - Supports deposit, withdraw, transfer in single circuit

### Frontend
- Pay page with cross-chain support, chain/token selectors
- PIN-based key derivation (wallet sig + PIN → PBKDF2)
- IndexedDB note encryption (AES-256-GCM)
- 30+ TypeScript library files for pool operations

---

## Source 2: Fhenix CoFHE

### FHE.sol API
**Encrypted Types**: ebool, euint8, euint16, euint32, euint64, euint128, eaddress

**Type Conversion**: FHE.asEuint32(value), FHE.asEbool(value), etc.
**From Encrypted Input**: FHE.asEuint32(InEuint32 input)

**Arithmetic**: add, sub, mul, div, rem, square
**Comparison**: eq, ne, lt, lte, gt, gte
**Bitwise**: and, or, xor, not, shl, shr, rol, ror
**Min/Max**: min, max
**Control Flow**: FHE.select(condition, ifTrue, ifFalse)
**Encrypt/Decrypt**: FHE.encrypt(), FHE.decrypt(), getDecryptResult(), publishDecryptResult()
**Access Control**: allow(), allowThis(), allowGlobal(), allowSender(), allowPublic(), allowTransient()

### cofhejs (Client SDK)
**Initialization**:
- cofhejs.initializeWithEthers(provider, signer, env)
- cofhejs.initializeWithViem(client, walletClient, env)

**Encryption**:
- Encryptable.bool(), .uint8(), .uint16(), .uint32(), .uint64(), .uint128(), .address()
- Returns: { ctHash: bigint, securityZone: number, utype: FheTypes, signature: bytes }
- setState callback for progress: Extract → Pack → Prove → Verify → Replace → Done

### React Hooks (@cofhe/react)
- useEncrypt — encrypt values client-side
- useWrite — write encrypted values to contracts
- useDecrypt — decrypt values from contracts

### Hardhat Plugin
- cofhe-hardhat-starter template
- Local mock environment for faster iteration
- pnpm test for testing, task-based deployment

### Example Counter Contract
```solidity
import "@fhenixprotocol/cofhe-contracts/FHE.sol";
contract Counter {
    euint32 public count;
    function increment() public {
        count = FHE.add(count, FHE.asEuint32(1));
        FHE.allowThis(count);
        FHE.allowSender(count);
    }
}
```

---

## Source 3: Privara / ReineiraOS

### What It Is
- ReineiraOS = Programmable stablecoin infrastructure with FHE
- Privara = Production implementation built on ReineiraOS (confidential payments)

### Core Primitives
1. **Escrow**: Holds money (FHE-encrypted on-chain)
2. **Resolver** (IConditionResolver): When escrow funds release
3. **Policy** (IUnderwriterPolicy): FHE-encrypted risk scoring + dispute resolution
4. **Operator**: Cross-chain CCTP relay, earns 0.5% of bridged volume

### Insurance Module
- Pool creation, staking, coverage, disputes
- evaluateRisk() returns encrypted risk score (euint64)
- judge() returns encrypted boolean verdict (ebool)
- Premium = coverage_amount * (risk_score_bps / 10000) — computed on encrypted values

### SDK (@reineira-os/sdk)
- sdk.insurance.createPool(), purchaseCoverage(), etc.
- sdk.bridge.checkHealth(), submitToCoordinator()
- sdk.events.onPoolCreated(), onCoveragePurchased(), etc.

### Deployed Contracts (Arbitrum Sepolia)
- ConfidentialEscrow: 0xC4333F84...
- ConfidentialCoverageManager: 0x766e9508...
- ConfidentialUSDC (cUSDC): 0x6b6e6479...
- PoolFactory: 0x03bAc36d...
- + 10 more contracts

### Economics
- Protocol fee: 30 bps on escrow creation
- Operator relay fee: 50 bps on cross-chain CCTP
- Insurance premium: 1-5% of coverage
- All fee arithmetic on FHE-encrypted ciphertexts

---

## Source 4: Competitive Analysis / Use Cases

### Top Ideas for Buildathon (Ranked)

1. **FHE-Enhanced Privacy Pool** (RECOMMENDED)
   - Migrate DustPool V2 to use FHE encrypted balances
   - Encrypted deposit amounts, hidden balances, FHE compliance
   - Leverages existing architecture, adds FHE primitives
   - Feasibility: HIGH | Innovation: HIGH | Demo-ability: HIGH

2. **Sealed-Bid Auction Protocol**
   - FHE-encrypted bids, on-chain comparison without reveal
   - Clean demo, clear value prop
   - Feasibility: HIGH | Innovation: MEDIUM | Demo-ability: HIGH

3. **Confidential Lending Protocol**
   - Private collateral ratios, encrypted health factors
   - Complex but impressive if executed
   - Feasibility: MEDIUM | Innovation: HIGH | Demo-ability: MEDIUM

4. **MEV-Protected DEX**
   - Encrypted order book with FHE comparison
   - Addresses $500M MEV problem directly
   - Feasibility: MEDIUM | Innovation: HIGH | Demo-ability: MEDIUM

5. **Private Governance**
   - Coercion-resistant voting, encrypted tallies
   - Clean FHE use case
   - Feasibility: HIGH | Innovation: MEDIUM | Demo-ability: HIGH

---

## Key Technical Decisions

### What to Build
**Recommended: "Dust FHE" — Confidential Privacy Pool with FHE**

Combines Dust Protocol's existing privacy infrastructure with Fhenix FHE:
1. ConfidentialDustPool — FHE-encrypted balances, deposits, withdrawals
2. FHE Compliance — Encrypted screening without revealing user data
3. Stealth + FHE — FHE-encrypted stealth meta-addresses
4. Privara Integration — Confidential payment escrow via ReineiraOS SDK

### Architecture
```
Frontend (Next.js + @cofhe/react)
    ↓
cofhejs SDK (client-side encryption)
    ↓
Smart Contracts (FHE.sol + DustPool logic)
    ↓
CoFHE Network (FHE computation)
    ↓
Arbitrum Sepolia (settlement)
```
