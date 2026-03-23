# Task Plan: Fhenix Private By Design dApp Buildathon

## Goal
Win Wave 1 ($3K) of the Fhenix buildathon by migrating Dust Protocol's privacy infrastructure to use FHE (Fully Homomorphic Encryption) via CoFHE, deployed on Arbitrum Sepolia/Base Sepolia. Deadline: March 28, 2026.

## Timeline
- **Today (Mar 20)**: Kickoff, planning, research complete
- **Mar 21-27**: Build period (7 days)
- **Mar 28-30**: Evaluation period
- **Wave 1 Allocation**: $3,000

## Phases
- [x] Phase 1: Research & codebase assessment (6 agents completed)
- [ ] Phase 2: Architecture design & master plan
- [ ] Phase 3: Smart contract development (FHE contracts)
- [ ] Phase 4: SDK/client integration (cofhejs + React hooks)
- [ ] Phase 5: Frontend development (privacy UX)
- [ ] Phase 6: Testing & deployment (Arbitrum Sepolia)
- [ ] Phase 7: Demo, documentation, submission

## Key Decisions
- **Target**: Confidential DeFi — FHE-encrypted privacy pool + stealth payments + encrypted compliance
- **Chain**: Arbitrum Sepolia (primary), Base Sepolia (secondary)
- **Stack**: CoFHE Solidity lib + cofhejs SDK + @cofhe/react hooks + Hardhat plugin
- **Strategy**: Migrate Dust's ZK-UTXO pool to FHE-native encrypted balances + add novel FHE features

## Judging Criteria Alignment
1. **Privacy Architecture** — FHE-native encrypted state, not just wrapped ZK proofs
2. **Innovation & Originality** — First ZK+FHE hybrid privacy pool, encrypted compliance
3. **User Experience** — Existing Dust frontend adapted with FHE UX patterns
4. **Technical Execution** — Clean Solidity, proper access control, tested
5. **Market Potential** — Confidential DeFi addresses $500M+ MEV problem

## Pyramid Agent Structure
```
                    [MASTER REVIEWER]
                   /        |        \
          [ARCH LEAD]  [CONTRACT LEAD]  [FRONTEND LEAD]
          /    \         /    |    \        /    \
      [R1] [R2]    [C1] [C2] [C3]    [F1] [F2]
                    [C4] [C5] [C6]    [F3] [F4]
```

## Agent Teams (30 agents total)

### Tier 1: Research & Architecture (Agents 1-6) ✅ COMPLETE
- Agent R1: Codebase explorer
- Agent R2: Fhenix docs researcher
- Agent R3: Privara/ReineiraOS researcher
- Agent R4: Example repos researcher
- Agent R5: Market/competitive researcher
- Agent R6: CoFHE SDK deep-dive

### Tier 2: Smart Contract Development (Agents 7-16)
- Agent C1: FHE Token contract (ConfidentialERC20)
- Agent C2: FHE Privacy Pool (ConfidentialDustPool)
- Agent C3: FHE Compliance module (encrypted screening)
- Agent C4: FHE Governance (sealed-bid voting)
- Agent C5: FHE Stealth Registry (encrypted meta-addresses)
- Agent C6: FHE Swap Hook (encrypted order matching)
- Agent C7: Contract test suite
- Agent C8: Deployment scripts
- Agent C9: Contract security review
- Agent C10: Gas optimization review

### Tier 3: Frontend & Integration (Agents 17-24)
- Agent F1: FHE encryption/decryption UI flows
- Agent F2: Privacy pool deposit/withdraw pages
- Agent F3: Confidential balance display components
- Agent F4: Chain selector + testnet integration
- Agent F5: Wallet connection + permit management
- Agent F6: Demo flow / guided walkthrough
- Agent F7: Frontend review (UX/a11y)
- Agent F8: Integration tests

### Tier 4: Review Pyramid (Agents 25-30)
- Agent L1: Architecture Lead (reviews C1-C6)
- Agent L2: Contract Lead (reviews C7-C10)
- Agent L3: Frontend Lead (reviews F1-F8)
- Agent L4: Security Sentinel (cross-cutting review)
- Agent L5: Demo/Presentation Lead
- Agent L6: Master Reviewer (final synthesis)

## Errors Encountered
- Several Fhenix doc URLs return 404 (cofhejs guides)
- @cofhe/sdk npm page access denied (permission issue in agents)

## Status
**Currently in Phase 2** — Creating master plan, preparing to launch Tier 2+3 agent teams
