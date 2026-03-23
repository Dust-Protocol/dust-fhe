import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { getServerSponsor } from '@/lib/server-provider';

export const maxDuration = 60;

const ARB_SEPOLIA_CHAIN_ID = 421614;
// Enough for one confidentialTransfer call (~300k gas at ~0.1 gwei on Arb Sepolia)
const GAS_AMOUNT = ethers.utils.parseEther('0.001');

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 60_000;
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

    const { stealthAddress } = await req.json();

    if (!stealthAddress || !/^0x[0-9a-fA-F]{40}$/.test(stealthAddress)) {
      return NextResponse.json({ error: 'Invalid stealth address' }, { status: 400 });
    }

    if (!checkCooldown(stealthAddress.toLowerCase())) {
      return NextResponse.json({ error: 'Please wait before requesting gas again' }, { status: 429 });
    }

    const balance = await sponsor.provider.getBalance(stealthAddress);
    if (balance.gte(GAS_AMOUNT)) {
      return NextResponse.json({ success: true, alreadyFunded: true });
    }

    const tx = await sponsor.sendTransaction({
      to: stealthAddress,
      value: GAS_AMOUNT,
      gasLimit: 21_000,
    });
    const receipt = await tx.wait();

    if (receipt.status === 0) {
      console.error('[FHE-ClaimGas] Funding tx reverted:', receipt.transactionHash);
      return NextResponse.json({ error: 'Funding transaction reverted' }, { status: 500 });
    }

    console.log('[FHE-ClaimGas] Funded:', stealthAddress, 'tx:', receipt.transactionHash);
    return NextResponse.json({ success: true, txHash: receipt.transactionHash });
  } catch (e) {
    console.error('[FHE-ClaimGas] Error:', e);
    return NextResponse.json({ error: 'Failed to fund gas' }, { status: 500 });
  }
}
