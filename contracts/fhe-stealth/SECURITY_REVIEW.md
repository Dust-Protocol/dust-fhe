# Security Review: ConfidentialToken.sol & FHENameRegistry.sol

**Reviewer:** Claude (automated)
**Date:** 2026-03-20
**Scope:** `contracts/ConfidentialToken.sol`, `contracts/FHENameRegistry.sol`
**Context:** Fhenix buildathon contracts, not mainnet-ready

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 1     |
| HIGH     | 3     |
| MEDIUM   | 3     |
| LOW      | 4     |
| INFO     | 3     |

---

## CRITICAL

### C-1: `withdraw` drains contract funds regardless of encrypted balance

**File:** `ConfidentialToken.sol` lines 92-112

The `withdraw` function uses `FHE.select` for constant-time encrypted balance deduction, but **always executes the plaintext ERC20 transfer** regardless of whether the user had sufficient encrypted balance. If the encrypted balance is insufficient, `FHE.select` keeps the balance unchanged (no-op), but the contract still sends real tokens via `safeTransfer` and decrements `totalWrapped`.

**Attack scenario:**
1. Alice deposits 100 USDC (encrypted balance = enc(100))
2. Alice calls `withdraw(100)` -- succeeds, balance = enc(0)
3. Alice calls `withdraw(100)` again -- encrypted balance stays enc(0) via `FHE.select`, but the contract transfers 100 USDC anyway
4. Alice repeats until the contract is drained

The `totalWrapped -= amount` will underflow on Solidity 0.8.x eventually, but only after enough other users have deposited to keep `totalWrapped` high.

**Impact:** Complete loss of all deposited funds. Any user can drain the contract.

**Recommended fix:** The withdraw function cannot use constant-time logic if it must conditionally execute a plaintext ERC20 transfer. Two options:
- (a) Require the user to decrypt their balance off-chain and submit a proof that their encrypted balance >= amount (Fhenix's `FHE.decrypt` or a permit/seal flow).
- (b) Use a two-step withdrawal: user requests withdrawal (encrypted deduction), then after FHE decryption callback confirms the deduction succeeded, release the plaintext tokens.

---

## HIGH

### H-1: `deposit` does not enforce `encAmount == amount`

**File:** `ConfidentialToken.sol` lines 65-83

The function accepts both `encAmount` (client-encrypted) and `amount` (plaintext). It pulls `amount` of ERC20 tokens but adds `encAmount` to the encrypted balance. Nothing enforces that these two values match. A user can deposit 1 USDC (plaintext) but claim an encrypted balance of `enc(1_000_000)`.

**Impact:** Users can mint arbitrary encrypted balances for the cost of 1 token. Combined with the withdraw bug (C-1), this makes the drain trivial. Even without C-1, the user could transfer inflated encrypted balances to others.

**Recommended fix:** Either:
- (a) Remove the `InEuint64 encAmount` parameter and compute the encrypted value inside the contract: `FHE.asEuint64(uint256(amount))`. The deposit amount is already public, so there is no privacy loss.
- (b) Use Fhenix's input validation to prove `encAmount` encrypts the same value as `amount`.

### H-2: Approval model is all-or-nothing with no revocation event

**File:** `ConfidentialToken.sol` lines 179-182

The `approve` function grants a boolean approval that allows the spender to call `confidentialTransferFrom` for **any encrypted amount, unlimited times**. There is no amount-based allowance and no event emitted on approval changes.

**Impact:**
- An approved spender can drain the entire encrypted balance of the approver in a single transaction.
- No `Approval` event means off-chain indexers and UIs cannot track approval state.
- Users who approve a contract (e.g., a DEX) cannot limit exposure.

**Recommended fix:**
- Emit an `Approval(address indexed owner, address indexed spender, bool approved)` event.
- For production: consider an encrypted allowance (`euint64`) or a nonce-based single-use approval.

### H-3: `_toLowerCase` mutates the input `memory` string

**File:** `FHENameRegistry.sol` lines 193-202

`_toLowerCase` takes a `string memory` parameter and mutates it in place. When called from `resolveName` on line 92, the input is `cleanName` (already a memory copy from `_stripSuffix`), so it works. But in `registerName`, line 63, it is called on `name` which is `calldata` -- Solidity copies calldata to memory when passing to a `memory` parameter, so this is safe. However, the mutation pattern is fragile and will break silently if a future refactor passes an already-in-memory string that is reused later.

**Impact:** No current exploit, but a high-risk maintenance hazard for a security-critical function (name hashing).

**Recommended fix:** Return a new `bytes` array instead of mutating in place, or add a comment explaining the safety invariant.

---

## MEDIUM

### M-1: Deposit/withdraw events leak exact amounts

**File:** `ConfidentialToken.sol` lines 27-29, 82, 111

`Deposited` and `Withdrawn` events emit the plaintext `amount`. While the code comments acknowledge this is inherent (the ERC20 transfer is public), these events make balance tracking trivial for chain observers. An observer can reconstruct exact balances for any address by watching deposit/withdraw events and correlating with `ConfidentialTransfer` events (which reveal sender/receiver pairs but not amounts).

**Impact:** Significantly reduces the privacy guarantees of the encrypted balance system. If a user deposits 1000, does one confidential transfer, then the recipient withdraws 1000, the transfer amount is obvious.

**Recommended fix:**
- Consider batched deposits/withdrawals or a pool pattern to break the correlation.
- At minimum, document this privacy limitation clearly for users.

### M-2: No name deactivation or release mechanism

**File:** `FHENameRegistry.sol`

Once registered, a name can be transferred but never deactivated or released by its owner. There is no `deactivateName` function. The `active` field in `MetaAddress` is set to `true` on registration and never changed.

**Impact:** Names are permanently locked. A user who no longer wants a name (e.g., compromised keys) cannot deactivate it, meaning senders may continue sending to stale stealth keys.

**Recommended fix:** Add a `deactivateName` function that sets `meta.active = false`, callable by the name owner.

### M-3: `transferName` does not update the `registry` entry

**File:** `FHENameRegistry.sol` lines 135-149

When a name is transferred, only `nameOwners` is updated. The `MetaAddress` in `registry` still contains the **old owner's** stealth keys. The new owner must separately call `updateMetaAddress` to set their own keys.

**Impact:** After transfer, if the new owner forgets to update keys, funds sent to that name go to stealth addresses controlled by the old owner.

**Recommended fix:** Either:
- (a) Require new keys as parameters to `transferName`.
- (b) Deactivate the name on transfer, forcing the new owner to reactivate with their own keys.

---

## LOW

### L-1: No self-transfer guard

**File:** `ConfidentialToken.sol` line 124

`confidentialTransfer` does not check `to != msg.sender`. A self-transfer wastes gas on FHE operations (two `FHE.select` calls) and could confuse off-chain indexers that see a `ConfidentialTransfer` event with `from == to`.

**Recommended fix:** Add `if (to == msg.sender) revert SelfTransfer();`

### L-2: Registration fee can be set to zero

**File:** `FHENameRegistry.sol` line 45, 153

The constructor accepts `_registrationFee` of 0, and `setRegistrationFee` can set it to 0. With zero fee, there is no economic barrier to name squatting -- an attacker can register all common names cheaply (only gas cost).

**Impact:** Name squatting renders the registry useless for legitimate users in a zero-fee configuration.

**Recommended fix:** Consider a minimum fee floor, or document that the owner is expected to set a non-zero fee.

### L-3: No pubkey validity check beyond length

**File:** `FHENameRegistry.sol` lines 59-60

Public keys are validated only for length (33 bytes for compressed secp256k1). The contract does not verify that the bytes represent a valid point on the curve. A user can register 33 bytes of zeros as a public key.

**Impact:** Names registered with invalid keys will silently fail when senders try to derive stealth addresses. The sender has no on-chain way to know the keys are invalid.

**Recommended fix:** On-chain secp256k1 point validation is expensive. At minimum, check that the first byte is 0x02 or 0x03 (compressed point prefix). Full validation should happen client-side.

### L-4: `withdrawFees` sends entire balance

**File:** `FHENameRegistry.sol` lines 160-164

`withdrawFees` sends `address(this).balance` to the owner. If the contract ever receives ETH outside of `registerName` (e.g., via `selfdestruct` from another contract, or a future `receive` function), that ETH is also swept.

**Impact:** Minimal, since there is no `receive()` or `fallback()` function. But if one is added later, unrelated ETH could be withdrawn.

**Recommended fix:** Track accumulated fees in a state variable and withdraw only that amount.

---

## INFO

### I-1: Floating pragma on FHENameRegistry

**File:** `FHENameRegistry.sol` line 2 -- `pragma solidity ^0.8.25;`

`ConfidentialToken.sol` uses pinned `0.8.25` while `FHENameRegistry.sol` uses floating `^0.8.25`. For deployment consistency, both should pin the same version.

### I-2: Missing `nonReentrant` on confidential transfer functions

**File:** `ConfidentialToken.sol` lines 120-128, 134-144

`confidentialTransfer` and `confidentialTransferFrom` do not use `nonReentrant`. Currently safe because there are no external calls in `_executeConfidentialTransfer`. However, if the FHE library ever introduces callbacks or if the function is extended with hooks, reentrancy could become possible.

**Recommended fix:** Add `nonReentrant` for defense in depth.

### I-3: No reverse lookup from address to all owned names

**File:** `FHENameRegistry.sol`

The `primaryNames` mapping only stores one name per address. There is no enumeration of all names owned by an address. This is a UX limitation, not a security issue, but worth noting for frontend design.

---

## Architecture Notes

**ConfidentialToken** has a fundamental design tension: deposits and withdrawals must bridge between plaintext ERC20 and encrypted FHE balances, but the constant-time `FHE.select` pattern (which prevents balance-check information leakage) is incompatible with conditional plaintext token transfers. The C-1 and H-1 findings are direct consequences of this tension.

**FHENameRegistry** is straightforward and well-structured. The main risks are operational (name squatting, stale keys after transfer) rather than fund-loss vulnerabilities.

**Priority for fixes before any testnet deployment:**
1. C-1: Withdraw drain (blocks any use of the contract)
2. H-1: Deposit amount mismatch (allows free minting)
3. M-3: Transfer name without key update (user safety)
