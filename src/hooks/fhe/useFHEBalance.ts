import { useCofheReadContractAndDecrypt } from '@cofhe/react';
import { FHE_CONTRACTS, ConfidentialTokenABI } from '@/lib/fhe';
import { useAccount } from 'wagmi';
import { useCallback } from 'react';

export function useFHEBalance() {
  const { address } = useAccount();

  const { encrypted, decrypted, disabledDueToMissingPermit } =
    useCofheReadContractAndDecrypt({
      address: FHE_CONTRACTS.confidentialToken,
      abi: ConfidentialTokenABI,
      functionName: 'getEncryptedBalanceOf',
      args: address ? [address] : undefined,
    });

  return {
    balance: decrypted.data !== undefined ? BigInt(decrypted.data) : null,
    isLoading: encrypted.isFetching || decrypted.isFetching,
    needsPermit: disabledDueToMissingPermit,
    error: encrypted.error?.message ?? decrypted.error?.message ?? null,
    refetch: useCallback(() => { void encrypted.refetch(); }, [encrypted.refetch]),
  };
}
