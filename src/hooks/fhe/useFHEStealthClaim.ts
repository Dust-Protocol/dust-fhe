import { useState, useCallback, useRef } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { useCofheEncrypt } from '@cofhe/react';
import { Encryptable } from '@cofhe/sdk';
import type { EncryptedItemInput } from '@cofhe/sdk';
import { ethers } from 'ethers';
import {
  FHE_CONTRACTS, FHE_CHAIN_ID,
  ConfidentialTokenABI,
} from '@/lib/fhe';
import type { Address } from 'viem';
import { encodeFunctionData } from 'viem';

export type ClaimStep =
  | 'idle'
  | 'funding'
  | 'decrypting'
  | 'encrypting'
  | 'transferring'
  | 'confirming'
  | 'success'
  | 'error';

interface UseFHEStealthClaimResult {
  claim: (stealthPrivateKey: string, stealthAddress: string, plaintextAmount: bigint) => Promise<string | null>;
  step: ClaimStep;
  isLoading: boolean;
  error: string | null;
  txHash: string | null;
  reset: () => void;
}

const ARB_SEPOLIA_RPC = 'https://sepolia-rollup.arbitrum.io/rpc';

function encryptedInputToContractArg(input: EncryptedItemInput): { data: `0x${string}` } {
  const sig = input.signature.startsWith('0x') ? input.signature : `0x${input.signature}`;
  return { data: sig as `0x${string}` };
}

/**
 * Claim FHE stealth payments by forwarding encrypted balance from a stealth
 * address to the connected wallet's main address.
 *
 * Flow:
 * 1. Sponsor gas to the stealth address (it has no ETH)
 * 2. Encrypt the known plaintext amount via CoFHE (produces InEuint64 with ZK proof)
 * 3. Send confidentialTransfer(mainAddress, encAmount) FROM the stealth wallet
 *
 * The caller must provide the plaintext amount — obtained by decrypting the
 * stealth balance during the scanning phase (Task 3). This avoids needing a
 * CoFHE permit for the stealth address, which would require the stealth wallet
 * to sign an EIP-712 permit message through the CoFHE React context.
 */
export function useFHEStealthClaim(): UseFHEStealthClaimResult {
  const { address: mainAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: FHE_CHAIN_ID });
  const { encryptInputsAsync } = useCofheEncrypt();
  const [step, setStep] = useState<ClaimStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const claimingRef = useRef(false);

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setTxHash(null);
  }, []);

  const claim = useCallback(async (
    stealthPrivateKey: string,
    stealthAddress: string,
    plaintextAmount: bigint,
  ): Promise<string | null> => {
    if (!mainAddress) { setError('Wallet not connected'); return null; }
    if (!publicClient) { setError('Public client not available'); return null; }
    if (claimingRef.current) return null;
    claimingRef.current = true;
    setError(null);
    setTxHash(null);

    try {
      const provider = new ethers.providers.JsonRpcProvider(ARB_SEPOLIA_RPC);

      // Step 1: Fund gas for the stealth address
      setStep('funding');
      const fundRes = await fetch('/api/fhe/sponsor-claim-gas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stealthAddress }),
      });
      if (!fundRes.ok) {
        const fundErr = await fundRes.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(fundErr.error || 'Failed to fund gas for stealth address');
      }
      const fundData = await fundRes.json();
      if (fundData.txHash) {
        await provider.waitForTransaction(fundData.txHash);
      }

      // Step 2: Encrypt the plaintext amount via CoFHE
      // confidentialTransfer requires InEuint64 — a client-encrypted input with
      // ZK proof against the network FHE public key. The CoFHE React context
      // handles key fetching, proof generation, and verification.
      setStep('encrypting');
      if (plaintextAmount <= 0n) {
        throw new Error('No balance to claim');
      }
      const encResult = await encryptInputsAsync([Encryptable.uint64(plaintextAmount)]);
      const encAmount = encResult[0];

      // Step 3: Build and send confidentialTransfer from the stealth wallet
      // We encode the calldata via viem (type-safe ABI encoding) and send
      // the raw tx via ethers (stealth private key not in wagmi)
      setStep('transferring');
      const calldata = encodeFunctionData({
        abi: ConfidentialTokenABI,
        functionName: 'confidentialTransfer',
        args: [mainAddress, encryptedInputToContractArg(encAmount)],
      });

      const stealthWallet = new ethers.Wallet(stealthPrivateKey, provider);
      const tx = await stealthWallet.sendTransaction({
        to: FHE_CONTRACTS.confidentialToken,
        data: calldata,
        gasLimit: 500_000,
      });

      setStep('confirming');
      const receipt = await tx.wait();
      if (receipt.status === 0) {
        throw new Error('Confidential transfer reverted');
      }

      setTxHash(receipt.transactionHash);
      setStep('success');
      return receipt.transactionHash;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Claim failed';
      setError(msg);
      setStep('error');
      return null;
    } finally {
      claimingRef.current = false;
    }
  }, [mainAddress, publicClient, encryptInputsAsync]);

  return {
    claim,
    step,
    isLoading: step !== 'idle' && step !== 'success' && step !== 'error',
    error,
    txHash,
    reset,
  };
}
