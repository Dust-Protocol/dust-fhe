import { useCofheConnection, useCofheAutoConnect } from '@cofhe/react';
import { useWalletClient, usePublicClient, useChainId } from 'wagmi';
import { FHE_CHAIN_ID } from '@/lib/fhe';

type InitState = 'idle' | 'connecting' | 'ready' | 'error' | 'wrong-chain';

interface UseFHEInitResult {
  state: InitState;
  isReady: boolean;
  error: string | null;
}

export function useFHEInit(): UseFHEInitResult {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: FHE_CHAIN_ID });
  const chainId = useChainId();

  useCofheAutoConnect({
    walletClient: walletClient ?? undefined,
    publicClient: publicClient ?? undefined,
  });

  const connection = useCofheConnection();

  if (!walletClient) {
    return { state: 'idle', isReady: false, error: null };
  }

  if (chainId !== FHE_CHAIN_ID) {
    return {
      state: 'wrong-chain',
      isReady: false,
      error: `Switch to Arbitrum Sepolia (chain ${FHE_CHAIN_ID})`,
    };
  }

  if (connection.connecting) {
    return { state: 'connecting', isReady: false, error: null };
  }

  if (connection.connectError) {
    const msg = connection.connectError instanceof Error
      ? connection.connectError.message
      : 'Failed to connect CoFHE SDK';
    return { state: 'error', isReady: false, error: msg };
  }

  if (connection.connected) {
    return { state: 'ready', isReady: true, error: null };
  }

  return { state: 'idle', isReady: false, error: null };
}
