import { Registry, Counter, Histogram, Gauge } from 'prom-client'

export const registry = new Registry()
registry.setDefaultLabels({ service: 'dust-relayer' })

// --- Counters ---

export const depositsTotal = new Counter({
  name: 'dust_deposits_total',
  help: 'Total deposits processed',
  labelNames: ['chain', 'asset', 'privacy_level'] as const,
  registers: [registry],
})

export const withdrawalsTotal = new Counter({
  name: 'dust_withdrawals_total',
  help: 'Total withdrawals processed',
  labelNames: ['chain', 'asset', 'privacy_level'] as const,
  registers: [registry],
})

export const transfersTotal = new Counter({
  name: 'dust_transfers_total',
  help: 'Total private transfers',
  labelNames: ['chain', 'privacy_level'] as const,
  registers: [registry],
})

export const swapsTotal = new Counter({
  name: 'dust_swaps_total',
  help: 'Total private swaps',
  labelNames: ['chain'] as const,
  registers: [registry],
})

export const proofsVerifiedTotal = new Counter({
  name: 'dust_proofs_verified_total',
  help: 'Total proofs verified',
  labelNames: ['chain', 'circuit_type', 'valid'] as const,
  registers: [registry],
})

export const http402PaymentsTotal = new Counter({
  name: 'dust_http402_payments_total',
  help: 'Total HTTP 402 payment verifications',
  labelNames: ['chain', 'privacy_level', 'status'] as const,
  registers: [registry],
})

// --- Histograms ---

export const proofVerificationDuration = new Histogram({
  name: 'dust_proof_verification_duration_seconds',
  help: 'Duration of proof verification',
  labelNames: ['circuit_type'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
})

export const treeSyncDuration = new Histogram({
  name: 'dust_tree_sync_duration_seconds',
  help: 'Duration of Merkle tree sync',
  labelNames: ['chain'] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
})

export const relayerGasUsed = new Histogram({
  name: 'dust_relayer_gas_used',
  help: 'Gas used by relayer transactions',
  labelNames: ['chain', 'operation'] as const,
  buckets: [50000, 100000, 200000, 500000, 1000000, 2000000],
  registers: [registry],
})

// --- Gauges ---

export const treeLeafCount = new Gauge({
  name: 'dust_tree_leaf_count',
  help: 'Number of leaves in Merkle tree',
  labelNames: ['chain'] as const,
  registers: [registry],
})

export const treeRootAge = new Gauge({
  name: 'dust_tree_root_age_seconds',
  help: 'Age of current Merkle root in seconds',
  labelNames: ['chain'] as const,
  registers: [registry],
})

export const poolTvl = new Gauge({
  name: 'dust_pool_tvl_wei',
  help: 'Total value locked in DustPool',
  labelNames: ['chain', 'asset'] as const,
  registers: [registry],
})

// --- Helper functions ---

export function incrementDeposit(chain: string, asset: string, privacyLevel: string): void {
  depositsTotal.labels(chain, asset, privacyLevel).inc()
}

export function incrementWithdrawal(chain: string, asset: string, privacyLevel: string): void {
  withdrawalsTotal.labels(chain, asset, privacyLevel).inc()
}

export function incrementTransfer(chain: string, privacyLevel: string): void {
  transfersTotal.labels(chain, privacyLevel).inc()
}

export function incrementSwap(chain: string): void {
  swapsTotal.labels(chain).inc()
}

export function recordProofVerification(chain: string, circuitType: string, valid: boolean): void {
  proofsVerifiedTotal.labels(chain, circuitType, String(valid)).inc()
}

export function observeProofVerification(circuitType: string, durationSeconds: number): void {
  proofVerificationDuration.labels(circuitType).observe(durationSeconds)
}

export function observeTreeSync(chain: string, durationSeconds: number): void {
  treeSyncDuration.labels(chain).observe(durationSeconds)
}

export function observeGasUsed(chain: string, operation: string, gas: number): void {
  relayerGasUsed.labels(chain, operation).observe(gas)
}

export function setTreeLeafCount(chain: string, count: number): void {
  treeLeafCount.labels(chain).set(count)
}

export function setTreeRootAge(chain: string, ageSeconds: number): void {
  treeRootAge.labels(chain).set(ageSeconds)
}

export function setPoolTvl(chain: string, asset: string, tvlWei: number): void {
  poolTvl.labels(chain, asset).set(tvlWei)
}

export function incrementHttp402Payment(chain: string, privacyLevel: string, status: string): void {
  http402PaymentsTotal.labels(chain, privacyLevel, status).inc()
}
