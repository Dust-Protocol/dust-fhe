import type { PaymentReceipt } from '@/types/http402'

const receiptStore = new Map<string, PaymentReceipt>()

export { receiptStore }
