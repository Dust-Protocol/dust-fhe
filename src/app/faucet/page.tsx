"use client";

import { useAccount, useWriteContract, useWaitForTransactionReceipt, useChainId, useSwitchChain } from "wagmi";
import { parseUnits } from "viem";
import { FHE_CONTRACTS, MockUSDCABI, FHE_CHAIN_ID } from "@/lib/fhe";

export default function FaucetPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const chainMismatch = isConnected && chainId !== FHE_CHAIN_ID;

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const handleMint = () => {
    if (!address) return;
    reset();
    writeContract({
      address: FHE_CONTRACTS.mockUSDC,
      abi: MockUSDCABI,
      functionName: 'mint',
      args: [address, parseUnits('1000', 6)],
    });
  };

  return (
    <div className="px-3.5 py-7 md:px-6 md:py-10 max-w-[480px] mx-auto">
      <div className="flex flex-col gap-5">
        <div className="text-center mb-2">
          <h1 className="text-2xl md:text-3xl font-bold tracking-widest text-white font-mono mb-1">
            FAUCET
          </h1>
          <p className="text-xs text-[rgba(255,255,255,0.4)] font-mono tracking-wide">
            Get test USDC for private payments
          </p>
        </div>

        {chainMismatch ? (
          <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(6,8,15,0.85)] p-8 flex flex-col items-center gap-4">
            <span className="text-sm text-[rgba(255,255,255,0.5)] font-mono">
              Switch to Arbitrum Sepolia
            </span>
            <button
              onClick={() => switchChain({ chainId: FHE_CHAIN_ID })}
              className="py-3 px-6 rounded-sm border border-[rgba(255,200,0,0.3)] bg-[rgba(255,200,0,0.06)] text-[#FFC800] font-mono text-xs font-semibold tracking-wider cursor-pointer hover:bg-[rgba(255,200,0,0.1)] transition-all"
            >
              SWITCH CHAIN
            </button>
          </div>
        ) : (
          <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(6,8,15,0.85)] p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white font-mono">USDC</span>
              <span className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono">1,000 per mint</span>
            </div>

            <button
              onClick={handleMint}
              disabled={isPending || isConfirming || !isConnected}
              className={`w-full py-3 rounded-sm font-mono text-sm font-bold tracking-wider flex items-center justify-center gap-2 transition-all ${
                isSuccess
                  ? "bg-[#00FF41]/10 border border-[#00FF41]/30 text-[#00FF41]"
                  : isPending || isConfirming
                    ? "bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.3)] cursor-wait"
                    : "bg-[#00FF41] hover:bg-[rgba(0,255,65,0.85)] text-black cursor-pointer active:scale-[0.98]"
              }`}
            >
              {isPending ? (
                <><div className="w-3.5 h-3.5 border-2 border-black/30 border-t-transparent rounded-full animate-spin" /> Minting...</>
              ) : isConfirming ? (
                <><div className="w-3.5 h-3.5 border-2 border-black/30 border-t-transparent rounded-full animate-spin" /> Confirming...</>
              ) : isSuccess ? (
                "Minted 1,000 USDC"
              ) : (
                "Mint 1,000 USDC"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
