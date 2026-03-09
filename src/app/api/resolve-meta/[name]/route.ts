import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { getChainConfig, getCanonicalNamingChain, DEFAULT_CHAIN_ID } from '@/config/chains';
import { getServerProvider } from '@/lib/server-provider';

const NAME_REGISTRY_ABI = [
  'function resolveName(string calldata name) external view returns (bytes)',
];

function stripDustSuffix(name: string): string {
  const n = name.toLowerCase().trim();
  return n.endsWith('.dust') ? n.slice(0, -5) : n;
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: Request, { params }: { params: { name: string } }) {
  try {
    const { name } = params;
    const normalized = stripDustSuffix(name);

    const url = new URL(req.url);
    const requestedChainId = parseInt(url.searchParams.get('chainId') || '') || DEFAULT_CHAIN_ID;
    const requestedConfig = getChainConfig(requestedChainId);
    const chainId = requestedConfig.contracts.nameRegistry ? requestedChainId : getCanonicalNamingChain().id;
    const config = getChainConfig(chainId);

    if (!config.contracts.nameRegistry) {
      return NextResponse.json({ error: 'No name registry on chain' }, { status: 400, headers: NO_STORE });
    }

    const provider = getServerProvider(chainId);
    const registry = new ethers.Contract(config.contracts.nameRegistry, NAME_REGISTRY_ABI, provider);

    const metaBytes: string = await registry.resolveName(normalized);
    if (!metaBytes || metaBytes === '0x' || metaBytes.length <= 4) {
      return NextResponse.json({ error: 'Name not found' }, { status: 404, headers: NO_STORE });
    }

    return NextResponse.json({ metaAddress: metaBytes }, { headers: NO_STORE });
  } catch (e) {
    console.error('[resolve-meta] Error:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Resolution failed' }, { status: 500, headers: NO_STORE });
  }
}
