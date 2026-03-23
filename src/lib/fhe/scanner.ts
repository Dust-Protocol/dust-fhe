import { ethers } from 'ethers';
import { FHE_CONTRACTS } from './contracts';
import {
  computeViewTag,
  computeStealthPrivateKey,
  getAddressFromPrivateKey,
} from '@/lib/stealth/address';
import type { StealthKeyPair } from '@/lib/stealth/types';

const STEALTH_TRANSFER_ABI = [
  'event StealthTransfer(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)',
];

const SCHEME_ID = 1;
const ARBITRUM_SEPOLIA_RPC = 'https://sepolia-rollup.arbitrum.io/rpc';

export interface FHEStealthPayment {
  stealthAddress: string;
  stealthPrivateKey: string;
  ephemeralPubKey: string;
  caller: string;
  txHash: string;
  blockNumber: number;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function scanFHEStealthTransfers(
  keys: StealthKeyPair,
  fromBlock: number,
  toBlock?: number | 'latest',
  provider?: ethers.providers.Provider,
): Promise<FHEStealthPayment[]> {
  const rpcProvider = provider ?? new ethers.providers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC);

  const contract = new ethers.Contract(
    FHE_CONTRACTS.stealthTransfer,
    STEALTH_TRANSFER_ABI,
    rpcProvider,
  );

  const resolvedTo = toBlock === 'latest' || toBlock === undefined
    ? await rpcProvider.getBlockNumber()
    : toBlock;

  const filter = contract.filters.StealthTransfer(SCHEME_ID, null, null);
  const events = await contract.queryFilter(filter, fromBlock, resolvedTo);

  const results: FHEStealthPayment[] = [];
  let viewTagFiltered = 0;
  let ecdhFiltered = 0;

  for (const event of events) {
    if (!event.args) continue;

    const ephemeralPubKeyRaw = event.args.ephemeralPubKey as string;
    const metadata = event.args.metadata as string;
    const stealthAddress = event.args.stealthAddress as string;
    const caller = event.args.caller as string;

    const ephemeralPubKey = ephemeralPubKeyRaw.replace(/^0x/, '');
    const eventViewTag = metadata?.length >= 4 ? metadata.slice(2, 4) : '';

    const expectedTag = computeViewTag(keys.viewingPrivateKey, ephemeralPubKey);
    if (eventViewTag && !constantTimeEqual(eventViewTag, expectedTag)) {
      viewTagFiltered++;
      continue;
    }

    const stealthPrivateKey = computeStealthPrivateKey(
      keys.spendingPrivateKey,
      keys.viewingPrivateKey,
      ephemeralPubKey,
    );
    const derivedEOA = getAddressFromPrivateKey(stealthPrivateKey);

    // FHE stealth transfers go directly to EOA (no CREATE2 factory indirection)
    if (derivedEOA.toLowerCase() !== stealthAddress.toLowerCase()) {
      ecdhFiltered++;
      continue;
    }

    results.push({
      stealthAddress,
      stealthPrivateKey,
      ephemeralPubKey,
      caller,
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
    });
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[FHE Scanner] ${events.length} events, ${results.length} matches, ` +
      `${viewTagFiltered} tag-filtered, ${ecdhFiltered} ECDH-filtered`,
    );
  }

  return results;
}
