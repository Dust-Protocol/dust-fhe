import { NextRequest, NextResponse } from 'next/server'
import type { PaymentReceipt } from '@/types/http402'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

// MVP: in-memory receipt store. Production would use a database.
export const receiptStore = new Map<string, PaymentReceipt>()

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const nonce = request.nextUrl.searchParams.get('nonce')
    if (!nonce) {
      return NextResponse.json(
        { error: 'Missing required query parameter: nonce' },
        { status: 400, headers: NO_STORE },
      )
    }

    const receipt = receiptStore.get(nonce)
    if (!receipt) {
      return NextResponse.json(
        { error: 'Receipt not found' },
        { status: 404, headers: NO_STORE },
      )
    }

    return NextResponse.json({ receipt }, { headers: NO_STORE })
  } catch (e) {
    console.error('[http402/receipt] Error:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: 'Failed to fetch receipt' },
      { status: 500, headers: NO_STORE },
    )
  }
}
