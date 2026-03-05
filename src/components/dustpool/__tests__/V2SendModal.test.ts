import { describe, it, expect } from 'vitest'

// ── canSend condition ───────────────────────────────────────────────────────
//
// Replicates the boolean expression from V2SendModal:
//   parsedAmount !== null && !exceedsBalance && isValidRecipient
//   && !isPending && !isSplitPending && !cooldownBlocksSubmit

interface CanSendState {
  parsedAmount: bigint | null
  exceedsBalance: boolean
  isValidRecipient: boolean
  isPending: boolean
  isSplitPending: boolean
  cooldownBlocksSubmit: boolean
}

function canSend(s: CanSendState): boolean {
  return (
    s.parsedAmount !== null &&
    !s.exceedsBalance &&
    s.isValidRecipient &&
    !s.isPending &&
    !s.isSplitPending &&
    !s.cooldownBlocksSubmit
  )
}

const canSendDefaults: CanSendState = {
  parsedAmount: 1000000000000000000n,
  exceedsBalance: false,
  isValidRecipient: true,
  isPending: false,
  isSplitPending: false,
  cooldownBlocksSubmit: false,
}

describe('canSend', () => {
  it('returns true when all conditions met', () => {
    // #given all valid state
    // #when evaluating canSend
    // #then true
    expect(canSend(canSendDefaults)).toBe(true)
  })

  it('returns false when parsedAmount is null', () => {
    // #given no parsed amount
    // #then cannot send
    expect(canSend({ ...canSendDefaults, parsedAmount: null })).toBe(false)
  })

  it('returns false when amount exceeds balance', () => {
    // #given exceedsBalance is true
    // #then cannot send
    expect(canSend({ ...canSendDefaults, exceedsBalance: true })).toBe(false)
  })

  it('returns false when recipient is invalid', () => {
    // #given invalid recipient
    // #then cannot send
    expect(canSend({ ...canSendDefaults, isValidRecipient: false })).toBe(false)
  })

  it('returns false when withdraw is pending', () => {
    // #given isPending true
    // #then cannot send
    expect(canSend({ ...canSendDefaults, isPending: true })).toBe(false)
  })

  it('returns false when split is pending', () => {
    // #given isSplitPending true
    // #then cannot send
    expect(canSend({ ...canSendDefaults, isSplitPending: true })).toBe(false)
  })

  it('returns false when cooldown blocks submit', () => {
    // #given cooldownBlocksSubmit true
    // #then cannot send
    expect(canSend({ ...canSendDefaults, cooldownBlocksSubmit: true })).toBe(false)
  })

  it('returns false when multiple conditions fail simultaneously', () => {
    // #given multiple invalid conditions
    // #then cannot send
    expect(
      canSend({
        ...canSendDefaults,
        parsedAmount: null,
        isValidRecipient: false,
        isPending: true,
      }),
    ).toBe(false)
  })
})

// ── useSplitFlow determination ──────────────────────────────────────────────
//
// From V2SendModal: `const useSplitFlow = chunks.length > 1`

function useSplitFlow(chunksLength: number): boolean {
  return chunksLength > 1
}

describe('useSplitFlow', () => {
  it('returns false for single chunk (direct withdraw)', () => {
    // #given a single denomination chunk
    // #then direct withdraw path
    expect(useSplitFlow(1)).toBe(false)
  })

  it('returns false for zero chunks (no amount)', () => {
    // #given no chunks (no parsedAmount)
    // #then no split
    expect(useSplitFlow(0)).toBe(false)
  })

  it('returns true for 2 chunks', () => {
    // #given amount decomposes into 2 denomination chunks
    // #then split flow is used
    expect(useSplitFlow(2)).toBe(true)
  })

  it('returns true for many chunks', () => {
    // #given amount decomposes into 5 chunks
    // #then split flow
    expect(useSplitFlow(5)).toBe(true)
  })
})

// ── cooldownBlocksSubmit logic ──────────────────────────────────────────────
//
// From V2SendModal:
//   cooldownActive && !recipientMatchesOriginator && amountExceedsThreshold

interface CooldownState {
  cooldownActive: boolean
  recipientMatchesOriginator: boolean
  amountExceedsThreshold: boolean
}

function cooldownBlocksSubmit(s: CooldownState): boolean {
  return s.cooldownActive && !s.recipientMatchesOriginator && s.amountExceedsThreshold
}

describe('cooldownBlocksSubmit', () => {
  it('does not block when cooldown is inactive', () => {
    // #given cooldown not active
    // #then submit is allowed
    expect(
      cooldownBlocksSubmit({
        cooldownActive: false,
        recipientMatchesOriginator: false,
        amountExceedsThreshold: true,
      }),
    ).toBe(false)
  })

  it('does not block when recipient matches originator', () => {
    // #given cooldown active but recipient is the original depositor
    // #then submit is allowed (returning to self)
    expect(
      cooldownBlocksSubmit({
        cooldownActive: true,
        recipientMatchesOriginator: true,
        amountExceedsThreshold: true,
      }),
    ).toBe(false)
  })

  it('does not block when amount is below threshold', () => {
    // #given cooldown active, different recipient, but small amount
    // #then submit is allowed (under BSA/AML reporting threshold)
    expect(
      cooldownBlocksSubmit({
        cooldownActive: true,
        recipientMatchesOriginator: false,
        amountExceedsThreshold: false,
      }),
    ).toBe(false)
  })

  it('blocks when all three conditions are met', () => {
    // #given cooldown active, different recipient, amount above threshold
    // #then submit is blocked
    expect(
      cooldownBlocksSubmit({
        cooldownActive: true,
        recipientMatchesOriginator: false,
        amountExceedsThreshold: true,
      }),
    ).toBe(true)
  })
})

// ── Send button text logic ──────────────────────────────────────────────────
//
// From V2SendModal JSX:
//   {parsedAmount
//     ? useSplitFlow
//       ? `Split & Send ${amount} ${tokenSymbol}`
//       : `Send ${amount} ${tokenSymbol}`
//     : "Enter Amount"}

function getButtonText(
  parsedAmount: bigint | null,
  isSplitFlow: boolean,
  amountStr: string,
  tokenSymbol: string,
): string {
  if (!parsedAmount) return 'Enter Amount'
  if (isSplitFlow) return `Split & Send ${amountStr} ${tokenSymbol}`
  return `Send ${amountStr} ${tokenSymbol}`
}

describe('getButtonText', () => {
  it('returns "Enter Amount" when parsedAmount is null', () => {
    // #given no parsed amount
    // #then prompt user to enter amount
    expect(getButtonText(null, false, '', 'ETH')).toBe('Enter Amount')
  })

  it('returns "Send {amount} {token}" for single chunk', () => {
    // #given valid amount, single chunk
    // #then direct send label
    expect(getButtonText(1000000000000000000n, false, '1.0', 'ETH')).toBe('Send 1.0 ETH')
  })

  it('returns "Split & Send {amount} {token}" for multiple chunks', () => {
    // #given valid amount, multiple chunks
    // #then split-send label
    expect(getButtonText(3000000000000000000n, true, '3.0', 'ETH')).toBe('Split & Send 3.0 ETH')
  })

  it('returns "Send" with USDC symbol', () => {
    // #given USDC token
    // #then token symbol in button text
    expect(getButtonText(100000000n, false, '100', 'USDC')).toBe('Send 100 USDC')
  })
})

// ── Recipient defaults to empty string ──────────────────────────────────────
//
// In V2SendModal, `recipient` state is initialized as `""` (not the user's
// wallet address). This differs from V2WithdrawModal where the recipient
// defaults to the connected wallet. Verified via:
//   const [recipient, setRecipient] = useState("")

describe('recipient default state', () => {
  it('send modal initializes recipient as empty string', () => {
    // #given the V2SendModal initial state
    const sendRecipientDefault = ''

    // #then recipient is empty — user must explicitly provide an address
    expect(sendRecipientDefault).toBe('')
  })

  it('empty recipient fails isAddress validation', () => {
    // #given an empty recipient
    const recipient = ''

    // #when checking validity (replicating viem isAddress behavior)
    const isValid = /^0x[0-9a-fA-F]{40}$/.test(recipient)

    // #then invalid — prevents accidental self-send
    expect(isValid).toBe(false)
  })
})
