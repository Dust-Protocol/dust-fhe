import { useState, useEffect, useCallback, useRef } from 'react';
import type { StealthKeyPair } from '@/lib/stealth/types';
import { scanFHEStealthTransfers, type FHEStealthPayment } from '@/lib/fhe/scanner';
import { storageKey } from '@/lib/storageKey';
import { FHE_CHAIN_ID } from '@/lib/fhe';

// FHE contract deployed recently — no events exist before this block
const DEPLOYMENT_BLOCK = 0;

const STORAGE_PREFIX = 'fhe_scanner';

function paymentsKey(address: string): string {
  return storageKey(STORAGE_PREFIX, address, FHE_CHAIN_ID);
}

function lastBlockKey(address: string): string {
  return storageKey('fhe_last_block', address, FHE_CHAIN_ID);
}

function loadPayments(address: string): FHEStealthPayment[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(paymentsKey(address));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePayments(address: string, payments: FHEStealthPayment[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(paymentsKey(address), JSON.stringify(payments));
  } catch { /* quota error — ignore */ }
}

function loadLastBlock(address: string): number | null {
  if (typeof window === 'undefined') return null;
  const val = localStorage.getItem(lastBlockKey(address));
  return val ? parseInt(val, 10) : null;
}

function saveLastBlock(address: string, block: number): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(lastBlockKey(address), block.toString());
}

export function useFHEStealthScanner(stealthKeys: StealthKeyPair | null, walletAddress: string | undefined) {
  const [payments, setPayments] = useState<FHEStealthPayment[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scanningRef = useRef(false);

  // Load persisted payments on mount
  useEffect(() => {
    if (!walletAddress) return;
    setPayments(loadPayments(walletAddress));
  }, [walletAddress]);

  const scan = useCallback(async () => {
    if (!stealthKeys || !walletAddress || scanningRef.current) return;
    scanningRef.current = true;
    setIsScanning(true);
    setError(null);

    try {
      const lastBlock = loadLastBlock(walletAddress);
      const fromBlock = lastBlock !== null ? lastBlock + 1 : DEPLOYMENT_BLOCK;

      const newPayments = await scanFHEStealthTransfers(stealthKeys, fromBlock, 'latest');

      setPayments(prev => {
        const existingTxHashes = new Set(prev.map(p => p.txHash));
        const deduped = newPayments.filter(p => !existingTxHashes.has(p.txHash));
        if (deduped.length === 0) return prev;
        const merged = [...prev, ...deduped];
        savePayments(walletAddress, merged);
        return merged;
      });

      // Persist the latest scanned block from results or current latest
      if (newPayments.length > 0) {
        const maxBlock = Math.max(...newPayments.map(p => p.blockNumber));
        saveLastBlock(walletAddress, maxBlock);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scan failed';
      setError(message);
      console.error('[FHE Scanner]', err);
    } finally {
      setIsScanning(false);
      scanningRef.current = false;
    }
  }, [stealthKeys, walletAddress]);

  // Auto-scan on mount when keys are available
  useEffect(() => {
    if (stealthKeys && walletAddress) {
      void scan();
    }
  }, [stealthKeys, walletAddress, scan]);

  return { payments, isScanning, scan, error };
}
