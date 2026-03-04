export type PrivacyLevel = 'transparent' | 'stealth' | 'private'

export interface PaymentRequirement {
  amount: string
  asset: string
  chainId: number
  recipient: string
  privacy: PrivacyLevel
  facilitator: string
  nonce: string
  expiresAt?: number
}

export interface PaymentProof {
  nonce: string
  privacy: PrivacyLevel
  chainId: number
  amount: string
  asset: string
  recipient: string
  signature?: string
  stealthAddress?: string
  ephemeralPublicKey?: string
  txHash?: string
  proof?: string
  nullifiers?: string[]
  outputCommitments?: string[]
  publicSignals?: string[]
}

export interface PaymentReceipt {
  nonce: string
  privacy: PrivacyLevel
  status: 'verified' | 'settled' | 'failed'
  txHash?: string
  timestamp: number
  amount: string
  asset: string
  chainId: number
}
