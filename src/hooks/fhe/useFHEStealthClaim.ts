import { useState, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';
import { Encryptable, FheTypes } from '@cofhe/sdk';
import type { EncryptedItemInput } from '@cofhe/sdk';
import { createCofheClient, createCofheConfig } from '@cofhe/sdk/web';
import { arbSepolia } from '@cofhe/sdk/chains';
import { ethers } from 'ethers';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import {
  FHE_CONTRACTS,
  ConfidentialTokenABI,
} from '@/lib/fhe';
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
  claim: (stealthPrivateKey: string, stealthAddress: string) => Promise<string | null>;
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

export function useFHEStealthClaim(): UseFHEStealthClaimResult {
  const { address: mainAddress } = useAccount();
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
  ): Promise<string | null> => {
    if (!mainAddress) { setError('Wallet not connected'); return null; }
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
        throw new Error(fundErr.error || 'Failed to fund gas');
      }
      const fundData = await fundRes.json();
      if (fundData.txHash) {
        await provider.waitForTransaction(fundData.txHash);
      }

      // Step 2: Decrypt stealth balance using stealth private key + CoFHE
      // The stealth address has FHE.allow for its own balance.
      // We create a temporary CoFHE client connected with the stealth wallet
      // to generate a permit and decrypt.
      setStep('decrypting');

      const stealthKey = stealthPrivateKey.startsWith('0x') ? stealthPrivateKey : `0x${stealthPrivateKey}`;
      const stealthAccount = privateKeyToAccount(stealthKey as `0x${string}`);

      const viemPublicClient = createPublicClient({
        chain: arbitrumSepolia,
        transport: http(ARB_SEPOLIA_RPC),
      });
      const stealthWalletClient = createWalletClient({
        account: stealthAccount,
        chain: arbitrumSepolia,
        transport: http(ARB_SEPOLIA_RPC),
      });

      // Read the encrypted balance handle
      const ctHash = await viemPublicClient.readContract({
        address: FHE_CONTRACTS.confidentialToken,
        abi: ConfidentialTokenABI,
        functionName: 'getEncryptedBalanceOf',
        args: [stealthAddress as `0x${string}`],
      });

      if (!ctHash || BigInt(ctHash as any) === 0n) {
        throw new Error('No encrypted balance at stealth address');
      }

      // Create a temporary CoFHE client with the stealth wallet
      const stealthCofheConfig = createCofheConfig({
        supportedChains: [arbSepolia],
      });
      const stealthCofheClient = createCofheClient(stealthCofheConfig);

      // Connect with stealth wallet
      await stealthCofheClient.connect(
        viemPublicClient as any,
        stealthWalletClient as any,
      );

      // Create a self-permit for the stealth address
      const permit = await stealthCofheClient.permits.getOrCreateSelfPermit(
        arbitrumSepolia.id,
        stealthAddress,
      );

      // Decrypt the balance
      const plaintextAmount = await stealthCofheClient.decryptForView(
        BigInt(ctHash as any),
        FheTypes.Uint64,
      )
        .withPermit(permit)
        .execute();

      const amount = BigInt(plaintextAmount as any);

      if (amount <= 0n) {
        stealthCofheClient.disconnect();
        throw new Error('Stealth balance is zero');
      }

      // Step 3: Re-encrypt with the stealth wallet's CoFHE context
      // The ZK proof must match the wallet that signs the tx (stealth wallet)
      setStep('encrypting');
      const encResult = await stealthCofheClient.encryptInputs([Encryptable.uint64(amount)]).execute();
      const encAmount = encResult[0];

      stealthCofheClient.disconnect();

      // Step 4: Send confidentialTransfer from stealth wallet → main address
      setStep('transferring');
      const calldata = encodeFunctionData({
        abi: ConfidentialTokenABI,
        functionName: 'confidentialTransfer',
        args: [mainAddress, encryptedInputToContractArg(encAmount)],
      });

      const ethersStealthWallet = new ethers.Wallet(stealthKey, provider);
      const tx = await ethersStealthWallet.sendTransaction({
        to: FHE_CONTRACTS.confidentialToken,
        data: calldata,
        gasLimit: 500_000,
      });

      setStep('confirming');
      const receipt = await tx.wait();
      if (receipt.status === 0) {
        throw new Error('Transfer reverted');
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
  }, [mainAddress]);

  return {
    claim,
    step,
    isLoading: step !== 'idle' && step !== 'success' && step !== 'error',
    error,
    txHash,
    reset,
  };
}
