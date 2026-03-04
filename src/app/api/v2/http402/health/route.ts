import { NextResponse } from 'next/server'
import { getSupportedChains } from '@/config/chains'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

const PRIVACY_LEVELS = ['transparent', 'stealth', 'private'] as const

export async function GET(): Promise<NextResponse> {
  const chainIds = getSupportedChains()
    .filter(c => c.contracts.dustPoolV2 !== null)
    .map(c => c.id)

  return NextResponse.json(
    {
      status: 'ok',
      version: '0.1.0',
      chainIds,
      privacyLevels: PRIVACY_LEVELS,
    },
    { headers: NO_STORE },
  )
}
