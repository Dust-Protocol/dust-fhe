import { useCofheEncrypt } from '@cofhe/react';
import { Encryptable } from '@cofhe/sdk';
import type { EncryptedItemInput, EncryptStep, EncryptStepCallbackContext } from '@cofhe/sdk';

interface UseFHEEncryptResult {
  encrypt: (amount: bigint) => Promise<EncryptedItemInput | null>;
  isEncrypting: boolean;
  lastStep: { step: EncryptStep; context?: EncryptStepCallbackContext } | null;
  error: Error | null;
  reset: () => void;
}

export function useFHEEncrypt(): UseFHEEncryptResult {
  const {
    encryptInputsAsync,
    isEncrypting,
    stepsState,
    error,
    reset,
  } = useCofheEncrypt();

  const encrypt = async (amount: bigint): Promise<EncryptedItemInput | null> => {
    try {
      const result = await encryptInputsAsync([Encryptable.uint64(amount)]);
      return result[0] ?? null;
    } catch {
      return null;
    }
  };

  return {
    encrypt,
    isEncrypting,
    lastStep: stepsState.lastStep,
    error: error ?? null,
    reset,
  };
}
