import { useState, useCallback, useRef } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { useCofheEncrypt } from '@cofhe/react';
import { Encryptable } from '@cofhe/sdk';
import type { EncryptedItemInput } from '@cofhe/sdk';
import {
  FHE_CONTRACTS, FHE_CHAIN_ID,
  ConfidentialTokenABI, FHEStealthTransferABI, FHENameRegistryABI, MockUSDCABI,
} from '@/lib/fhe';
import { generateStealthAddress } from '@/lib/stealth/address';
import type { StealthMetaAddress } from '@/lib/stealth/types';
import type { Address } from 'viem';
import { parseUnits } from 'viem';

export type SendStep =
  | 'idle'
  | 'resolving'
  | 'deriving'
  | 'approving-underlying'
  | 'depositing'
  | 'encrypting'
  | 'approving-stealth'
  | 'sending'
  | 'confirming'
  | 'success'
  | 'error';

interface UseFHEStealthSendResult {
  sendEncryptedToStealth: (name: string, amount: string) => Promise<string | null>;
  step: SendStep;
  isLoading: boolean;
  error: string | null;
  reset: () => void;
}

function encryptedInputToContractArg(input: EncryptedItemInput): { data: `0x${string}` } {
  const sig = input.signature.startsWith('0x') ? input.signature : `0x${input.signature}`;
  return { data: sig as `0x${string}` };
}

export function useFHEStealthSend(): UseFHEStealthSendResult {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: FHE_CHAIN_ID });
  const { data: walletClient } = useWalletClient();
  const { encryptInputsAsync } = useCofheEncrypt();
  const [step, setStep] = useState<SendStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
  }, []);

  const sendEncryptedToStealth = useCallback(async (
    name: string,
    amount: string,
  ): Promise<string | null> => {
    if (!isConnected || !address || !walletClient || !publicClient) {
      setError('Wallet not connected');
      return null;
    }
    if (sendingRef.current) return null;
    sendingRef.current = true;
    setError(null);

    try {
      setStep('resolving');

      // Wave 1: .dust names only. Direct 0x sends require ERC-6538 registry integration.
      if (name.startsWith('0x') && name.length === 42) {
        throw new Error('Direct 0x address sends coming soon — use a .dust name');
      }

      const [spendingPubKey, viewingPubKey] = await publicClient.readContract({
        address: FHE_CONTRACTS.nameRegistry,
        abi: FHENameRegistryABI,
        functionName: 'resolveName',
        args: [name],
      });

      if (!spendingPubKey || !viewingPubKey) {
        throw new Error(`Name "${name}" not found in FHE registry`);
      }

      setStep('deriving');
      const spendingHex = (spendingPubKey as string).replace(/^0x/, '');
      const viewingHex = (viewingPubKey as string).replace(/^0x/, '');

      const meta: StealthMetaAddress = {
        prefix: 'st:arb:',
        spendingPublicKey: spendingHex,
        viewingPublicKey: viewingHex,
        raw: `0x${spendingHex}${viewingHex}`,
      };
      const generated = generateStealthAddress(meta, FHE_CHAIN_ID);

      const amountParsed = parseUnits(amount, 6);
      const amountUint64 = BigInt(amountParsed);

      setStep('approving-underlying');
      const currentAllowance = await publicClient.readContract({
        address: FHE_CONTRACTS.mockUSDC,
        abi: MockUSDCABI,
        functionName: 'allowance',
        args: [address, FHE_CONTRACTS.confidentialToken],
      });

      if ((currentAllowance as bigint) < amountParsed) {
        const approveHash = await walletClient.writeContract({
          address: FHE_CONTRACTS.mockUSDC,
          abi: MockUSDCABI,
          functionName: 'approve',
          args: [FHE_CONTRACTS.confidentialToken, amountParsed],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      setStep('depositing');
      const depositHash = await walletClient.writeContract({
        address: FHE_CONTRACTS.confidentialToken,
        abi: ConfidentialTokenABI,
        functionName: 'deposit',
        args: [amountUint64],
      });
      const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
      if (depositReceipt.status === 'reverted') {
        throw new Error('Deposit transaction reverted');
      }

      setStep('encrypting');
      const encResult = await encryptInputsAsync([Encryptable.uint64(amountUint64)]);
      const encAmount = encResult[0];

      setStep('approving-stealth');
      const isApproved = await publicClient.readContract({
        address: FHE_CONTRACTS.confidentialToken,
        abi: ConfidentialTokenABI,
        functionName: 'approvals',
        args: [address, FHE_CONTRACTS.stealthTransfer],
      });

      if (!isApproved) {
        const approveCtHash = await walletClient.writeContract({
          address: FHE_CONTRACTS.confidentialToken,
          abi: ConfidentialTokenABI,
          functionName: 'approve',
          args: [FHE_CONTRACTS.stealthTransfer, true],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveCtHash });
      }

      setStep('sending');
      const ephPubKey = `0x${generated.ephemeralPublicKey.replace(/^0x/, '')}` as `0x${string}`;
      const viewTagBytes = `0x${generated.viewTag}` as `0x${string}`;

      const sendHash = await walletClient.writeContract({
        address: FHE_CONTRACTS.stealthTransfer,
        abi: FHEStealthTransferABI,
        functionName: 'stealthSend',
        args: [
          generated.stealthEOAAddress as Address,
          encryptedInputToContractArg(encAmount),
          ephPubKey,
          viewTagBytes,
        ],
      });

      setStep('confirming');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: sendHash });
      if (receipt.status === 'reverted') {
        throw new Error('Stealth send transaction reverted');
      }

      setStep('success');
      return sendHash;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to send encrypted payment';
      setError(msg);
      setStep('error');
      return null;
    } finally {
      sendingRef.current = false;
    }
  }, [isConnected, address, walletClient, publicClient, encryptInputsAsync]);

  return {
    sendEncryptedToStealth,
    step,
    isLoading: step !== 'idle' && step !== 'success' && step !== 'error',
    error,
    reset,
  };
}
