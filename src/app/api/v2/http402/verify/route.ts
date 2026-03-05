import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import { getServerProvider } from '@/lib/server-provider'
import { isChainSupported } from '@/config/chains'
import { getDustPoolV2Address, DUST_POOL_V2_ABI } from '@/lib/dustpool/v2/contracts'
import { toBytes32Hex } from '@/lib/dustpool/poseidon'
import { incrementHttp402Payment } from '@/lib/metrics'
import type { PaymentProof, PaymentRequirement, PaymentReceipt, PrivacyLevel } from '@/types/http402'
import { receiptStore } from '../receipt-store'

export const maxDuration = 30

const NO_STORE = { 'Cache-Control': 'no-store' } as const

const VALID_PRIVACY_LEVELS: ReadonlySet<PrivacyLevel> = new Set(['transparent', 'stealth', 'private'])

function isValidPrivacyLevel(value: string): value is PrivacyLevel {
  return VALID_PRIVACY_LEVELS.has(value as PrivacyLevel)
}

// EIP-712 signature is 65 bytes hex-encoded (0x prefix + 130 hex chars)
// Matches: 0x followed by 130 hex characters
const EIP712_SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/

function isValidEip712Signature(sig: string): boolean {
  return EIP712_SIGNATURE_RE.test(sig)
}

async function verifyTransparent(
  proof: PaymentProof,
  requirement: PaymentRequirement,
): Promise<{ valid: boolean; settled: boolean; txHash?: string }> {
  if (!proof.txHash) {
    return { valid: false, settled: false }
  }

  if (proof.signature && !isValidEip712Signature(proof.signature)) {
    return { valid: false, settled: false }
  }

  const provider = getServerProvider(proof.chainId)
  const receipt = await provider.getTransactionReceipt(proof.txHash)
  if (!receipt || receipt.status !== 1) {
    return { valid: false, settled: false }
  }

  const tx = await provider.getTransaction(proof.txHash)
  if (!tx) {
    return { valid: false, settled: false }
  }

  const expectedAmount = BigInt(requirement.amount)
  const txValue = BigInt(tx.value.toString())
  if (txValue < expectedAmount) {
    return { valid: false, settled: false }
  }

  if (tx.to?.toLowerCase() !== requirement.recipient.toLowerCase()) {
    return { valid: false, settled: false }
  }

  // Transparent payments settle on-chain at payment time
  return { valid: true, settled: true, txHash: proof.txHash }
}

async function verifyStealth(
  proof: PaymentProof,
  requirement: PaymentRequirement,
): Promise<{ valid: boolean; settled: boolean; txHash?: string }> {
  if (!proof.txHash) {
    return { valid: false, settled: false }
  }

  if (!proof.stealthAddress || !proof.ephemeralPublicKey) {
    return { valid: false, settled: false }
  }

  const provider = getServerProvider(proof.chainId)
  const receipt = await provider.getTransactionReceipt(proof.txHash)
  if (!receipt || receipt.status !== 1) {
    return { valid: false, settled: false }
  }

  const tx = await provider.getTransaction(proof.txHash)
  if (!tx) {
    return { valid: false, settled: false }
  }

  const expectedAmount = BigInt(requirement.amount)
  const txValue = BigInt(tx.value.toString())
  if (txValue < expectedAmount) {
    return { valid: false, settled: false }
  }

  // Stealth payments settle on-chain at payment time
  return { valid: true, settled: true, txHash: proof.txHash }
}

async function verifyPrivate(
  proof: PaymentProof,
): Promise<{ valid: boolean; settled: boolean; txHash?: string }> {
  if (!proof.proof || !proof.publicSignals || !Array.isArray(proof.publicSignals)) {
    return { valid: false, settled: false }
  }

  // 9 public signals: [merkleRoot, null0, null1, outC0, outC1, pubAmount, pubAsset, recipient, chainId]
  if (proof.publicSignals.length !== 9) {
    return { valid: false, settled: false }
  }

  if (!proof.nullifiers || proof.nullifiers.length === 0) {
    return { valid: false, settled: false }
  }

  // Validate proof bytes format (FFLONK proof: 768 bytes = 0x prefix + 1536 hex chars)
  if (!/^0x[0-9a-fA-F]{1536}$/.test(proof.proof)) {
    return { valid: false, settled: false }
  }

  const poolAddress = getDustPoolV2Address(proof.chainId)
  if (!poolAddress) {
    return { valid: false, settled: false }
  }

  const provider = getServerProvider(proof.chainId)
  const contract = new ethers.Contract(
    poolAddress,
    DUST_POOL_V2_ABI as unknown as ethers.ContractInterface,
    provider,
  )

  // Verify nullifiers are not already spent
  for (const nullifier of proof.nullifiers) {
    const nullifierHex = toBytes32Hex(BigInt(nullifier))
    const spent: boolean = await contract.nullifiers(nullifierHex)
    if (spent) {
      return { valid: false, settled: false }
    }
  }

  // Verify the Merkle root is known on-chain
  const merkleRoot = toBytes32Hex(BigInt(proof.publicSignals[0]))
  const rootKnown: boolean = await contract.isKnownRoot(merkleRoot)
  if (!rootKnown) {
    return { valid: false, settled: false }
  }

  // Cross-chain replay prevention: chainId in proof must match requested chainId
  const proofChainId = BigInt(proof.publicSignals[8])
  if (proofChainId !== BigInt(proof.chainId)) {
    return { valid: false, settled: false }
  }

  // Private payments require settlement via the relayer (withdraw flow)
  // The proof is valid but not yet settled on-chain
  return {
    valid: true,
    settled: false,
    txHash: proof.txHash,
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = await req.json()
    const { proof, requirement } = body as {
      proof: PaymentProof
      requirement: PaymentRequirement
    }

    if (!proof || !requirement) {
      return NextResponse.json(
        { error: 'Missing required fields: proof, requirement' },
        { status: 400, headers: NO_STORE },
      )
    }

    if (!proof.nonce || !proof.privacy || !proof.chainId) {
      return NextResponse.json(
        { error: 'Proof must include nonce, privacy, and chainId' },
        { status: 400, headers: NO_STORE },
      )
    }

    if (!isValidPrivacyLevel(proof.privacy)) {
      return NextResponse.json(
        { error: `Invalid privacy level: ${proof.privacy}. Must be one of: transparent, stealth, private` },
        { status: 400, headers: NO_STORE },
      )
    }

    if (!isChainSupported(proof.chainId)) {
      return NextResponse.json(
        { error: `Unsupported chain: ${proof.chainId}` },
        { status: 400, headers: NO_STORE },
      )
    }

    if (requirement.expiresAt && Math.floor(Date.now() / 1000) > requirement.expiresAt) {
      return NextResponse.json(
        { error: 'Payment requirement has expired' },
        { status: 400, headers: NO_STORE },
      )
    }

    let result: { valid: boolean; settled: boolean; txHash?: string }

    switch (proof.privacy) {
      case 'transparent':
        result = await verifyTransparent(proof, requirement)
        break
      case 'stealth':
        result = await verifyStealth(proof, requirement)
        break
      case 'private':
        result = await verifyPrivate(proof)
        break
    }

    const chainStr = String(proof.chainId)
    incrementHttp402Payment(chainStr, proof.privacy, result.valid ? 'verified' : 'failed')

    // Prevent nonce reuse — a nonce can only be verified once
    const existingReceipt = receiptStore.get(proof.nonce)
    if (existingReceipt) {
      return NextResponse.json(
        { error: `Nonce already ${existingReceipt.status}` },
        { status: 409, headers: NO_STORE },
      )
    }

    let receipt: PaymentReceipt | undefined
    if (result.valid) {
      receipt = {
        nonce: proof.nonce,
        privacy: proof.privacy,
        status: result.settled ? 'settled' : 'verified',
        txHash: result.txHash,
        timestamp: Date.now(),
        amount: requirement.amount,
        asset: requirement.asset,
        chainId: proof.chainId,
      }
      receiptStore.set(proof.nonce, receipt)
    }

    return NextResponse.json(
      {
        valid: result.valid,
        settled: result.settled,
        receipt,
      },
      { headers: NO_STORE },
    )
  } catch (e) {
    console.error('[http402/verify] Error:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: 'Verification failed' },
      { status: 500, headers: NO_STORE },
    )
  }
}
