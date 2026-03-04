// Server-side Sparse Merkle Tree for the exclusion compliance set.
//
// Wraps circomlibjs's Poseidon-based SMT to maintain the set of flagged
// (sanctioned/blocked) commitments. Generates non-membership witnesses
// compatible with the DustV2Compliance circuit (SMTVerifier with 20 levels).
//
// Singleton per chain, persisted to /tmp for cold-start recovery.

import { readFile, writeFile } from 'fs/promises'
import type { SMTInstance } from 'circomlibjs'

const SMT_LEVELS = 20

export interface ComplianceWitness {
  exclusionRoot: bigint
  smtSiblings: bigint[]
  smtOldKey: bigint
  smtOldValue: bigint
  smtIsOld0: bigint
}

interface ExclusionCheckpoint {
  version: 1
  chainId: number
  flaggedCommitments: string[]
  savedAt: number
}

// Sentinel ensures the SMT always has a non-zero root, even on cold start.
// Without this, the contract rejects updateExclusionRoot(bytes32(0)) and the
// compliance flow deadlocks. Value 1n can never be a valid Poseidon commitment.
const SENTINEL_COMMITMENT = 1n

// Module-level singletons
const trees = new Map<number, SMTInstance>()
const flaggedSets = new Map<number, Set<string>>()
const initPromises = new Map<number, Promise<SMTInstance>>()

function checkpointPath(chainId: number): string {
  return `/tmp/dust-v2-exclusion-${chainId}.json`
}

function normalize(commitment: bigint): string {
  return '0x' + commitment.toString(16).padStart(64, '0')
}

async function loadCheckpoint(chainId: number): Promise<ExclusionCheckpoint | null> {
  try {
    const data = await readFile(checkpointPath(chainId), 'utf-8')
    const cp: ExclusionCheckpoint = JSON.parse(data)
    if (cp.version !== 1 || cp.chainId !== chainId || !Array.isArray(cp.flaggedCommitments)) {
      return null
    }
    return cp
  } catch {
    return null
  }
}

function saveCheckpointAsync(chainId: number): void {
  const flagged = flaggedSets.get(chainId)
  if (!flagged) return

  const checkpoint: ExclusionCheckpoint = {
    version: 1,
    chainId,
    flaggedCommitments: Array.from(flagged),
    savedAt: Date.now(),
  }

  writeFile(checkpointPath(chainId), JSON.stringify(checkpoint))
    .then(() =>
      console.log(`[ExclusionTree] Checkpoint saved: chain=${chainId} flagged=${checkpoint.flaggedCommitments.length}`),
    )
    .catch(() => {})
}

async function createTree(): Promise<SMTInstance> {
  const { newMemEmptyTrie } = await import('circomlibjs')
  return (await newMemEmptyTrie()) as SMTInstance
}

async function initTree(chainId: number): Promise<SMTInstance> {
  const smt = await createTree()
  const flagged = new Set<string>()

  const checkpoint = await loadCheckpoint(chainId)
  if (checkpoint && checkpoint.flaggedCommitments.length > 0) {
    console.log(
      `[ExclusionTree] Restoring from checkpoint: chain=${chainId} flagged=${checkpoint.flaggedCommitments.length}`,
    )
    for (const hex of checkpoint.flaggedCommitments) {
      const key = BigInt(hex)
      await smt.insert(smt.F.e(key), smt.F.e(1n))
      flagged.add(normalize(key))
    }
  }

  // Bootstrap: insert sentinel so the root is always non-zero.
  // Idempotent — skipped if sentinel already present from checkpoint.
  if (!flagged.has(normalize(SENTINEL_COMMITMENT))) {
    await smt.insert(smt.F.e(SENTINEL_COMMITMENT), smt.F.e(1n))
    flagged.add(normalize(SENTINEL_COMMITMENT))
    saveCheckpointAsync(chainId)
  }

  trees.set(chainId, smt)
  flaggedSets.set(chainId, flagged)
  return smt
}

async function getTree(chainId: number): Promise<SMTInstance> {
  const existing = trees.get(chainId)
  if (existing) return existing

  const pending = initPromises.get(chainId)
  if (pending) return pending

  const promise = initTree(chainId)
  initPromises.set(chainId, promise)
  try {
    return await promise
  } finally {
    initPromises.delete(chainId)
  }
}

/**
 * Add a flagged commitment to the exclusion set.
 * Returns the new exclusion root.
 */
export async function addFlaggedCommitment(chainId: number, commitment: bigint): Promise<bigint> {
  const smt = await getTree(chainId)
  const flagged = flaggedSets.get(chainId)!
  const key = normalize(commitment)

  if (flagged.has(key)) {
    return smt.F.toObject(smt.root)
  }

  // SMT stores (key=commitment, value=1) — convention matches circuit's smtVerifier.value <== 1
  await smt.insert(smt.F.e(commitment), smt.F.e(1n))
  flagged.add(key)

  saveCheckpointAsync(chainId)
  return smt.F.toObject(smt.root)
}

/**
 * Remove a commitment from the exclusion set (e.g., sanctions list updated).
 * Returns the new exclusion root.
 */
export async function removeFlaggedCommitment(chainId: number, commitment: bigint): Promise<bigint> {
  const smt = await getTree(chainId)
  const flagged = flaggedSets.get(chainId)!
  const key = normalize(commitment)

  if (!flagged.has(key)) {
    return smt.F.toObject(smt.root)
  }

  await smt.delete(smt.F.e(commitment))
  flagged.delete(key)

  saveCheckpointAsync(chainId)
  return smt.F.toObject(smt.root)
}

/**
 * Check if a commitment is in the exclusion set.
 */
export async function isCommitmentFlagged(chainId: number, commitment: bigint): Promise<boolean> {
  const smt = await getTree(chainId)
  const result = await smt.find(smt.F.e(commitment))
  return result.found
}

/**
 * Generate a non-membership witness for the DustV2Compliance circuit.
 * Throws if the commitment IS in the exclusion set (can't prove non-membership).
 */
export async function generateComplianceWitness(
  chainId: number,
  commitment: bigint,
): Promise<ComplianceWitness> {
  const smt = await getTree(chainId)
  const F = smt.F
  const result = await smt.find(F.e(commitment))

  if (result.found) {
    throw new Error(`Commitment ${normalize(commitment)} is in the exclusion set — cannot generate non-membership proof`)
  }

  // Pad siblings to SMT_LEVELS (circuit expects fixed 20 siblings)
  const siblings: bigint[] = []
  for (let i = 0; i < SMT_LEVELS; i++) {
    if (i < result.siblings.length) {
      siblings.push(F.toObject(result.siblings[i]))
    } else {
      siblings.push(0n)
    }
  }

  return {
    exclusionRoot: F.toObject(smt.root),
    smtSiblings: siblings,
    smtOldKey: result.isOld0 ? 0n : F.toObject(result.notFoundKey!),
    smtOldValue: result.isOld0 ? 0n : F.toObject(result.notFoundValue!),
    smtIsOld0: result.isOld0 ? 1n : 0n,
  }
}

/**
 * Get the current exclusion root for a chain.
 */
export async function getExclusionRoot(chainId: number): Promise<bigint> {
  const smt = await getTree(chainId)
  return smt.F.toObject(smt.root)
}

/**
 * Get the count of flagged commitments for a chain.
 */
export async function getFlaggedCount(chainId: number): Promise<number> {
  await getTree(chainId)
  const flagged = flaggedSets.get(chainId)
  return flagged ? flagged.size : 0
}

/**
 * Batch-add multiple flagged commitments. More efficient than individual adds
 * because it only saves one checkpoint at the end.
 */
export async function batchAddFlagged(chainId: number, commitments: bigint[]): Promise<bigint> {
  const smt = await getTree(chainId)
  const flagged = flaggedSets.get(chainId)!

  for (const commitment of commitments) {
    const key = normalize(commitment)
    if (flagged.has(key)) continue
    await smt.insert(smt.F.e(commitment), smt.F.e(1n))
    flagged.add(key)
  }

  saveCheckpointAsync(chainId)
  return smt.F.toObject(smt.root)
}
