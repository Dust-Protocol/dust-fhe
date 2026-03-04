import { describe, it, expect, beforeEach } from 'vitest'

// Use a unique chainId per test to get isolated tree instances.
// Seed from timestamp to avoid collisions with /tmp checkpoints from prior runs.
let nextChainId = 900000 + (Date.now() % 100000)

function freshChainId(): number {
  return nextChainId++
}

// Dynamic import to handle ESM circomlibjs
async function getModule() {
  return await import('../exclusion-tree')
}

describe('exclusion-tree', () => {
  describe('addFlaggedCommitment', () => {
    it('returns non-zero root after adding a commitment', async () => {
      // #given
      const chainId = freshChainId()
      const { addFlaggedCommitment } = await getModule()

      // #when
      const root = await addFlaggedCommitment(chainId, 42n)

      // #then
      expect(root).not.toBe(0n)
    })

    it('is idempotent for duplicate adds', async () => {
      // #given
      const chainId = freshChainId()
      const { addFlaggedCommitment } = await getModule()

      // #when
      const root1 = await addFlaggedCommitment(chainId, 100n)
      const root2 = await addFlaggedCommitment(chainId, 100n)

      // #then
      expect(root1).toBe(root2)
    })

    it('changes root when new commitment added', async () => {
      // #given
      const chainId = freshChainId()
      const { addFlaggedCommitment } = await getModule()

      // #when
      const root1 = await addFlaggedCommitment(chainId, 200n)
      const root2 = await addFlaggedCommitment(chainId, 300n)

      // #then
      expect(root1).not.toBe(root2)
    })
  })

  describe('isCommitmentFlagged', () => {
    it('returns true for a flagged commitment', async () => {
      // #given
      const chainId = freshChainId()
      const { addFlaggedCommitment, isCommitmentFlagged } = await getModule()
      await addFlaggedCommitment(chainId, 500n)

      // #when
      const result = await isCommitmentFlagged(chainId, 500n)

      // #then
      expect(result).toBe(true)
    })

    it('returns false for an unflagged commitment', async () => {
      // #given
      const chainId = freshChainId()
      const { addFlaggedCommitment, isCommitmentFlagged } = await getModule()
      await addFlaggedCommitment(chainId, 600n)

      // #when
      const result = await isCommitmentFlagged(chainId, 999n)

      // #then
      expect(result).toBe(false)
    })

    it('returns true for sentinel commitment on fresh tree', async () => {
      // #given — tree auto-seeds with sentinel (1n)
      const chainId = freshChainId()
      const { isCommitmentFlagged } = await getModule()

      // #when
      const result = await isCommitmentFlagged(chainId, 1n)

      // #then — sentinel is always present
      expect(result).toBe(true)
    })

    it('returns false for non-sentinel on fresh tree', async () => {
      // #given
      const chainId = freshChainId()
      const { isCommitmentFlagged } = await getModule()

      // #when
      const result = await isCommitmentFlagged(chainId, 999n)

      // #then
      expect(result).toBe(false)
    })
  })

  describe('removeFlaggedCommitment', () => {
    it('removes a commitment from the exclusion set', async () => {
      // #given
      const chainId = freshChainId()
      const { addFlaggedCommitment, removeFlaggedCommitment, isCommitmentFlagged } = await getModule()
      await addFlaggedCommitment(chainId, 700n)

      // #when
      await removeFlaggedCommitment(chainId, 700n)

      // #then
      expect(await isCommitmentFlagged(chainId, 700n)).toBe(false)
    })

    it('is idempotent for non-existent commitment', async () => {
      // #given
      const chainId = freshChainId()
      const { getExclusionRoot, removeFlaggedCommitment } = await getModule()

      // #when
      const rootBefore = await getExclusionRoot(chainId)
      await removeFlaggedCommitment(chainId, 999n)
      const rootAfter = await getExclusionRoot(chainId)

      // #then
      expect(rootBefore).toBe(rootAfter)
    })
  })

  describe('generateComplianceWitness', () => {
    it('generates valid witness for unflagged commitment on sentinel-only tree', async () => {
      // #given — tree has sentinel (1n) but no user-added commitments
      const chainId = freshChainId()
      const { generateComplianceWitness } = await getModule()

      // #when
      const witness = await generateComplianceWitness(chainId, 42n)

      // #then
      expect(witness.smtSiblings).toHaveLength(20)
      expect(witness.exclusionRoot).not.toBe(0n)
    })

    it('generates valid witness for unflagged commitment on populated tree', async () => {
      // #given
      const chainId = freshChainId()
      const { addFlaggedCommitment, generateComplianceWitness } = await getModule()
      await addFlaggedCommitment(chainId, 1000n)
      await addFlaggedCommitment(chainId, 2000n)

      // #when — commitment 42 is NOT in the exclusion set
      const witness = await generateComplianceWitness(chainId, 42n)

      // #then
      expect(witness.smtSiblings).toHaveLength(20)
      expect(witness.exclusionRoot).not.toBe(0n)
    })

    it('throws for flagged commitment', async () => {
      // #given
      const chainId = freshChainId()
      const { addFlaggedCommitment, generateComplianceWitness } = await getModule()
      await addFlaggedCommitment(chainId, 800n)

      // #when / #then
      await expect(generateComplianceWitness(chainId, 800n)).rejects.toThrow(
        'is in the exclusion set',
      )
    })

    it('witness exclusionRoot matches current tree root', async () => {
      // #given
      const chainId = freshChainId()
      const { addFlaggedCommitment, generateComplianceWitness, getExclusionRoot } = await getModule()
      await addFlaggedCommitment(chainId, 3000n)

      // #when
      const witness = await generateComplianceWitness(chainId, 42n)
      const root = await getExclusionRoot(chainId)

      // #then
      expect(witness.exclusionRoot).toBe(root)
    })
  })

  describe('batchAddFlagged', () => {
    it('adds multiple commitments', async () => {
      // #given
      const chainId = freshChainId()
      const { batchAddFlagged, isCommitmentFlagged, getFlaggedCount } = await getModule()

      // #when
      await batchAddFlagged(chainId, [10n, 20n, 30n])

      // #then — 3 user commitments + 1 sentinel
      expect(await getFlaggedCount(chainId)).toBe(4)
      expect(await isCommitmentFlagged(chainId, 10n)).toBe(true)
      expect(await isCommitmentFlagged(chainId, 20n)).toBe(true)
      expect(await isCommitmentFlagged(chainId, 30n)).toBe(true)
    })

    it('skips duplicates in batch', async () => {
      // #given
      const chainId = freshChainId()
      const { addFlaggedCommitment, batchAddFlagged, getFlaggedCount } = await getModule()
      await addFlaggedCommitment(chainId, 10n)

      // #when
      await batchAddFlagged(chainId, [10n, 20n])

      // #then — 2 user commitments + 1 sentinel
      expect(await getFlaggedCount(chainId)).toBe(3)
    })
  })

  describe('getExclusionRoot', () => {
    it('returns non-zero for fresh tree (sentinel seeded)', async () => {
      // #given
      const chainId = freshChainId()
      const { getExclusionRoot } = await getModule()

      // #when
      const root = await getExclusionRoot(chainId)

      // #then — sentinel ensures non-zero root
      expect(root).not.toBe(0n)
    })
  })

  describe('getFlaggedCount', () => {
    it('returns 1 for fresh tree (sentinel only)', async () => {
      // #given
      const chainId = freshChainId()
      const { getFlaggedCount } = await getModule()

      // #when
      const count = await getFlaggedCount(chainId)

      // #then — sentinel is always present
      expect(count).toBe(1)
    })
  })
})
