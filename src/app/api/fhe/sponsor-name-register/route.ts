import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { getServerSponsor } from '@/lib/server-provider';

export const maxDuration = 60;

const FHE_NAME_REGISTRY = '0x31DdFEB4Fc83a248E8CD48991c4C8E68EB96B537';
const ARB_SEPOLIA_CHAIN_ID = 421614;

const ABI = [
  'function registerName(string calldata name, bytes calldata spendingPubKey, bytes calldata viewingPubKey) external payable',
  'function isNameAvailable(string calldata name) external view returns (bool)',
];

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 30_000;
const MAX_ENTRIES = 500;

function checkCooldown(key: string): boolean {
  const now = Date.now();
  if (cooldowns.size > MAX_ENTRIES) {
    for (const [k, t] of cooldowns) {
      if (now - t > COOLDOWN_MS) cooldowns.delete(k);
    }
  }
  const last = cooldowns.get(key);
  if (last && now - last < COOLDOWN_MS) return false;
  cooldowns.set(key, now);
  return true;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const sponsor = getServerSponsor(ARB_SEPOLIA_CHAIN_ID);

    const { name, spendingPubKey, viewingPubKey } = await req.json();

    if (!name || !spendingPubKey || !viewingPubKey) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const stripped = name.toLowerCase().replace(/\.dust$/, '').trim();
    if (!stripped || stripped.length < 3 || stripped.length > 32 || !/^[a-z0-9_-]+$/.test(stripped)) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }

    if (!checkCooldown(stripped)) {
      return NextResponse.json({ error: 'Please wait before registering again' }, { status: 429 });
    }

    const spendHex = spendingPubKey.startsWith('0x') ? spendingPubKey : '0x' + spendingPubKey;
    const viewHex = viewingPubKey.startsWith('0x') ? viewingPubKey : '0x' + viewingPubKey;

    // 33-byte compressed secp256k1 pubkey = 66 hex chars + '0x' prefix = 68
    if (spendHex.length !== 68 || viewHex.length !== 68) {
      return NextResponse.json({ error: 'Public keys must be 33 bytes (compressed secp256k1)' }, { status: 400 });
    }

    const registry = new ethers.Contract(FHE_NAME_REGISTRY, ABI, sponsor);

    const available = await registry.isNameAvailable(stripped);
    if (!available) {
      return NextResponse.json({ success: true, alreadyRegistered: true });
    }

    const tx = await registry.registerName(stripped, spendHex, viewHex, {
      value: 0,
      gasLimit: 300_000,
    });
    const receipt = await tx.wait();

    if (receipt.status === 0) {
      console.error('[FHE-NameRegister] Transaction reverted:', receipt.transactionHash);
      return NextResponse.json({ error: 'Transaction reverted' }, { status: 500 });
    }

    console.log('[FHE-NameRegister] Registered:', stripped, 'tx:', receipt.transactionHash);
    return NextResponse.json({ success: true, txHash: receipt.transactionHash });
  } catch (e) {
    console.error('[FHE-NameRegister] Error:', e);
    return NextResponse.json({ error: 'FHE name registration failed' }, { status: 500 });
  }
}
