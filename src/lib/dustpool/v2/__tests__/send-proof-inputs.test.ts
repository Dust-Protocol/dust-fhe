import { describe, it, expect } from 'vitest'
import { createNote } from '../note'
import { computeNoteCommitment } from '../commitment'
import { BN254_FIELD_SIZE, TREE_DEPTH } from '../constants'
import { buildWithdrawInputs } from '../proof-inputs'
import type { NoteCommitmentV2, V2Keys } from '../types'

const MOCK_OWNER = 12345678901234567890n
const MOCK_AMOUNT = 1000000000000000000n // 1 ETH in wei
const MOCK_ASSET = 99999n
const MOCK_CHAIN_ID = 11155111
const MOCK_RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

const keys: V2Keys = {
  spendingKey: 111111n,
  nullifierKey: 222222n,
}

const dummyMerkleProof = {
  pathElements: new Array<bigint>(TREE_DEPTH).fill(0n),
  pathIndices: new Array<number>(TREE_DEPTH).fill(0),
}

async function buildInputNote(
  owner: bigint,
  amount: bigint,
  asset: bigint,
  chainId: number,
  leafIndex = 0,
): Promise<NoteCommitmentV2> {
  const note = createNote(owner, amount, asset, chainId)
  const commitment = await computeNoteCommitment(note)
  return { note, commitment, leafIndex }
}

// ── Send to external EOA — recipient field ──────────────────────────────────

describe('buildWithdrawInputs — send to external EOA', () => {
  it('sets recipient to BigInt(address) for an external recipient', async () => {
    // #given an input note and an external recipient address
    const inputNote = await buildInputNote(MOCK_OWNER, MOCK_AMOUNT, MOCK_ASSET, MOCK_CHAIN_ID)

    // #when building withdraw inputs targeting that recipient
    const result = await buildWithdrawInputs(
      inputNote,
      MOCK_AMOUNT,
      MOCK_RECIPIENT,
      keys,
      dummyMerkleProof,
      MOCK_CHAIN_ID,
    )

    // #then recipient equals BigInt of the address
    expect(result.recipient).toBe(BigInt(MOCK_RECIPIENT))
  })

  it('sets recipient to 0x-prefixed address value regardless of case', async () => {
    // #given a checksummed address
    const inputNote = await buildInputNote(MOCK_OWNER, MOCK_AMOUNT, MOCK_ASSET, MOCK_CHAIN_ID)
    const lower = MOCK_RECIPIENT.toLowerCase()

    // #when building with lowercase address
    const result = await buildWithdrawInputs(
      inputNote,
      MOCK_AMOUNT,
      lower,
      keys,
      dummyMerkleProof,
      MOCK_CHAIN_ID,
    )

    // #then BigInt conversion is identical (case insensitive for hex)
    expect(result.recipient).toBe(BigInt(lower))
  })
})

// ── Field-negative publicAmount encoding ────────────────────────────────────

describe('buildWithdrawInputs — publicAmount encoding', () => {
  it('encodes publicAmount as BN254_FIELD_SIZE - withdrawAmount', async () => {
    // #given a note with 1 ETH
    const inputNote = await buildInputNote(MOCK_OWNER, MOCK_AMOUNT, MOCK_ASSET, MOCK_CHAIN_ID)
    const withdrawAmount = 500000000000000000n // 0.5 ETH

    // #when building withdraw inputs for partial withdrawal
    const result = await buildWithdrawInputs(
      inputNote,
      withdrawAmount,
      MOCK_RECIPIENT,
      keys,
      dummyMerkleProof,
      MOCK_CHAIN_ID,
    )

    // #then publicAmount = FIELD_SIZE - amount (field-negative encoding)
    expect(result.publicAmount).toBe(BN254_FIELD_SIZE - withdrawAmount)
  })

  it('encodes full withdrawal as FIELD_SIZE - full amount', async () => {
    // #given a note withdrawn in full
    const inputNote = await buildInputNote(MOCK_OWNER, MOCK_AMOUNT, MOCK_ASSET, MOCK_CHAIN_ID)

    // #when withdrawing the entire note
    const result = await buildWithdrawInputs(
      inputNote,
      MOCK_AMOUNT,
      MOCK_RECIPIENT,
      keys,
      dummyMerkleProof,
      MOCK_CHAIN_ID,
    )

    // #then publicAmount = FIELD_SIZE - full amount
    expect(result.publicAmount).toBe(BN254_FIELD_SIZE - MOCK_AMOUNT)
  })
})

// ── publicAsset matches input note ──────────────────────────────────────────

describe('buildWithdrawInputs — publicAsset', () => {
  it('sets publicAsset to the input note asset', async () => {
    // #given a note with a specific asset id
    const customAsset = 42424242n
    const inputNote = await buildInputNote(MOCK_OWNER, MOCK_AMOUNT, customAsset, MOCK_CHAIN_ID)

    // #when building withdraw inputs
    const result = await buildWithdrawInputs(
      inputNote,
      MOCK_AMOUNT,
      MOCK_RECIPIENT,
      keys,
      dummyMerkleProof,
      MOCK_CHAIN_ID,
    )

    // #then publicAsset matches the note's asset
    expect(result.publicAsset).toBe(customAsset)
  })
})

// ── Withdrawal amount exceeds note balance ──────────────────────────────────

describe('buildWithdrawInputs — amount validation', () => {
  it('throws when withdrawal amount exceeds note balance', async () => {
    // #given a note with 1 ETH
    const inputNote = await buildInputNote(MOCK_OWNER, MOCK_AMOUNT, MOCK_ASSET, MOCK_CHAIN_ID)
    const excessiveAmount = MOCK_AMOUNT + 1n

    // #when attempting to withdraw more than the note holds
    // #then an error is thrown
    await expect(
      buildWithdrawInputs(
        inputNote,
        excessiveAmount,
        MOCK_RECIPIENT,
        keys,
        dummyMerkleProof,
        MOCK_CHAIN_ID,
      ),
    ).rejects.toThrow(/exceeds note balance/)
  })

  it('does not throw when amount equals note balance exactly', async () => {
    // #given a note with 1 ETH
    const inputNote = await buildInputNote(MOCK_OWNER, MOCK_AMOUNT, MOCK_ASSET, MOCK_CHAIN_ID)

    // #when withdrawing exactly the note balance
    // #then no error
    await expect(
      buildWithdrawInputs(
        inputNote,
        MOCK_AMOUNT,
        MOCK_RECIPIENT,
        keys,
        dummyMerkleProof,
        MOCK_CHAIN_ID,
      ),
    ).resolves.toBeDefined()
  })
})

// ── Change note computation ─────────────────────────────────────────────────

describe('buildWithdrawInputs — change note', () => {
  it('creates a change note with correct amount for partial withdrawal', async () => {
    // #given a 1 ETH note, withdrawing 0.3 ETH
    const inputNote = await buildInputNote(MOCK_OWNER, MOCK_AMOUNT, MOCK_ASSET, MOCK_CHAIN_ID)
    const withdrawAmount = 300000000000000000n

    // #when building withdraw inputs
    const result = await buildWithdrawInputs(
      inputNote,
      withdrawAmount,
      MOCK_RECIPIENT,
      keys,
      dummyMerkleProof,
      MOCK_CHAIN_ID,
    )

    // #then output 0 is the change note with remaining amount
    const expectedChange = MOCK_AMOUNT - withdrawAmount
    expect(result.outAmount[0]).toBe(expectedChange)
  })

  it('preserves owner on auto-generated change note', async () => {
    // #given a partial withdrawal
    const inputNote = await buildInputNote(MOCK_OWNER, MOCK_AMOUNT, MOCK_ASSET, MOCK_CHAIN_ID)
    const withdrawAmount = 500000000000000000n

    // #when building withdraw inputs
    const result = await buildWithdrawInputs(
      inputNote,
      withdrawAmount,
      MOCK_RECIPIENT,
      keys,
      dummyMerkleProof,
      MOCK_CHAIN_ID,
    )

    // #then change note owner matches input note owner
    expect(result.outOwner[0]).toBe(MOCK_OWNER)
  })

  it('preserves asset on auto-generated change note', async () => {
    // #given a partial withdrawal
    const inputNote = await buildInputNote(MOCK_OWNER, MOCK_AMOUNT, MOCK_ASSET, MOCK_CHAIN_ID)
    const withdrawAmount = 500000000000000000n

    // #when building withdraw inputs
    const result = await buildWithdrawInputs(
      inputNote,
      withdrawAmount,
      MOCK_RECIPIENT,
      keys,
      dummyMerkleProof,
      MOCK_CHAIN_ID,
    )

    // #then change note asset matches input note asset
    expect(result.outAsset[0]).toBe(MOCK_ASSET)
  })

  it('creates dummy change note (amount=0) for full withdrawal', async () => {
    // #given a full withdrawal (amount == note balance)
    const inputNote = await buildInputNote(MOCK_OWNER, MOCK_AMOUNT, MOCK_ASSET, MOCK_CHAIN_ID)

    // #when withdrawing the full amount
    const result = await buildWithdrawInputs(
      inputNote,
      MOCK_AMOUNT,
      MOCK_RECIPIENT,
      keys,
      dummyMerkleProof,
      MOCK_CHAIN_ID,
    )

    // #then change output is a dummy note (all zeros)
    expect(result.outAmount[0]).toBe(0n)
    expect(result.outOwner[0]).toBe(0n)
  })

  it('uses caller-supplied change note when provided', async () => {
    // #given a pre-created change note with custom blinding
    const inputNote = await buildInputNote(MOCK_OWNER, MOCK_AMOUNT, MOCK_ASSET, MOCK_CHAIN_ID)
    const withdrawAmount = 600000000000000000n
    const customChange = createNote(MOCK_OWNER, MOCK_AMOUNT - withdrawAmount, MOCK_ASSET, MOCK_CHAIN_ID)

    // #when building with explicit changeNote
    const result = await buildWithdrawInputs(
      inputNote,
      withdrawAmount,
      MOCK_RECIPIENT,
      keys,
      dummyMerkleProof,
      MOCK_CHAIN_ID,
      customChange,
    )

    // #then output uses the caller-supplied change note's blinding
    expect(result.outBlinding[0]).toBe(customChange.blinding)
    expect(result.outAmount[0]).toBe(customChange.amount)
  })
})

// ── chainId propagation ─────────────────────────────────────────────────────

describe('buildWithdrawInputs — chainId', () => {
  it('sets chainId public signal from argument', async () => {
    // #given a specific chainId
    const inputNote = await buildInputNote(MOCK_OWNER, MOCK_AMOUNT, MOCK_ASSET, MOCK_CHAIN_ID)

    // #when building withdraw inputs
    const result = await buildWithdrawInputs(
      inputNote,
      MOCK_AMOUNT,
      MOCK_RECIPIENT,
      keys,
      dummyMerkleProof,
      MOCK_CHAIN_ID,
    )

    // #then chainId public signal is set
    expect(result.chainId).toBe(BigInt(MOCK_CHAIN_ID))
  })
})
