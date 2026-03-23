"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { useAccount, useConnect, useChainId, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { injected } from "wagmi/connectors";
import { useFHEInit, useFHEBalance, useFHEStealthScanner } from "@/hooks/fhe";
import { FHE_CHAIN_ID, FHE_CONTRACTS, MockUSDCABI } from "@/lib/fhe";
import { useAuth } from "@/contexts/AuthContext";
import { DustLogo } from "@/components/DustLogo";
import { useRouter } from "next/navigation";
import { formatUnits, parseUnits } from "viem";

const FHEProviderWrapper = dynamic(() => import("@/app/fhe/FHEProviderWrapper"), { ssr: false });

function DashboardContent() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { stealthKeys, ownedNames } = useAuth();
  const { state: fheState } = useFHEInit();
  const { balance, isLoading: balanceLoading, error: balanceError, needsPermit, refetch } = useFHEBalance();
  const { payments, isScanning, scan, error: scanError } = useFHEStealthScanner(stealthKeys, address);
  const router = useRouter();

  const [recipient, setRecipient] = useState("");
  const [showSendInput, setShowSendInput] = useState(false);

  const { writeContract: mintUSDC, data: mintTxHash, isPending: isMinting, reset: resetMint } = useWriteContract();
  const { isLoading: isMintConfirming, isSuccess: isMintSuccess } = useWaitForTransactionReceipt({ hash: mintTxHash });

  const chainMismatch = isConnected && chainId !== FHE_CHAIN_ID;
  const formattedBalance = balance !== null ? formatUnits(balance, 6) : null;
  const dustName = ownedNames.length > 0 ? `${ownedNames[0].name}.dust` : null;

  const handleMint = () => {
    if (!address) return;
    resetMint();
    mintUSDC({
      address: FHE_CONTRACTS.mockUSDC,
      abi: MockUSDCABI,
      functionName: 'mint',
      args: [address, parseUnits('1000', 6)],
    });
  };

  const handleSendNavigate = () => {
    const name = recipient.trim().replace(/\.dust$/i, '');
    if (!name) return;
    router.push(`/fhe/pay/${encodeURIComponent(name)}`);
  };

  return (
    <div className="px-3.5 py-7 md:px-6 md:py-7 max-w-[640px] mx-auto">
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="text-center mb-2">
          <h1 className="text-2xl md:text-3xl font-bold tracking-widest text-white font-mono mb-1">
            STEALTH_WALLET
          </h1>
          <p className="text-xs text-[rgba(255,255,255,0.4)] font-mono tracking-wide">
            Private payments with FHE encryption
          </p>
        </div>

        {/* Testnet banner */}
        <div className="px-3 py-1.5 rounded-sm bg-[rgba(255,200,0,0.06)] border border-[rgba(255,200,0,0.15)] text-center">
          <span className="text-[10px] text-[#eab308] font-mono tracking-wider">
            ARBITRUM SEPOLIA TESTNET
          </span>
        </div>

        {!isConnected ? (
          <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(6,8,15,0.85)] p-8 flex flex-col items-center gap-5">
            <DustLogo size={40} color="#00FF41" />
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-lg font-bold text-white font-mono">FHE Stealth Payments</span>
              <span className="text-[11px] text-[rgba(255,255,255,0.35)] font-mono text-center max-w-[300px]">
                Send and receive private payments. Stealth addresses hide who, FHE hides how much.
              </span>
            </div>
            <button
              onClick={() => connect({ connector: injected() })}
              className="w-full max-w-[280px] py-3 rounded-sm border border-[#00FF41]/30 bg-[#00FF41]/[0.05] text-[#00FF41] font-mono text-xs font-semibold tracking-wider flex items-center justify-center gap-2 cursor-pointer hover:border-[#00FF41] hover:bg-[#00FF41]/[0.1] transition-all"
            >
              CONNECT WALLET
            </button>
          </div>
        ) : chainMismatch ? (
          <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(6,8,15,0.85)] p-8 flex flex-col items-center gap-4">
            <span className="text-sm text-[rgba(255,255,255,0.5)] font-mono">
              Switch to Arbitrum Sepolia to use encrypted payments
            </span>
            <button
              onClick={() => switchChain({ chainId: FHE_CHAIN_ID })}
              className="py-3 px-6 rounded-sm border border-[rgba(255,200,0,0.3)] bg-[rgba(255,200,0,0.06)] text-[#FFC800] font-mono text-xs font-semibold tracking-wider cursor-pointer hover:bg-[rgba(255,200,0,0.1)] transition-all"
            >
              SWITCH TO ARBITRUM SEPOLIA
            </button>
          </div>
        ) : (
          <>
            {/* Encrypted Balance Card */}
            <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(6,8,15,0.85)] backdrop-blur-md p-5">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">
                    Encrypted Balance
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00FF41" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <span className="text-[10px] text-[rgba(0,255,65,0.5)] font-mono">On-chain encrypted, client-side decrypted</span>
                  </div>
                </div>
                <button
                  onClick={refetch}
                  disabled={balanceLoading}
                  className="text-[10px] text-[#00FF41] font-mono cursor-pointer bg-transparent border border-[#00FF41]/20 rounded-sm px-2 py-1 hover:bg-[#00FF41]/10 transition-all disabled:opacity-50 disabled:cursor-wait"
                >
                  {balanceLoading ? "..." : "REFRESH"}
                </button>
              </div>

              <div className="flex items-baseline gap-2">
                {balanceLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-[rgba(255,255,255,0.3)] font-mono">Loading...</span>
                  </div>
                ) : balanceError ? (
                  <span className="text-sm text-[#ef4444] font-mono">{balanceError}</span>
                ) : (
                  <>
                    <span className="text-3xl font-extrabold text-white font-mono">
                      {formattedBalance ?? "—"}
                    </span>
                    <span className="text-base text-[rgba(255,255,255,0.4)] font-medium">USDC</span>
                  </>
                )}
              </div>

              {needsPermit && (
                <div className="mt-3 px-3 py-2 rounded-sm border border-[#00FF41]/20 bg-[#00FF41]/[0.04]">
                  <span className="text-[10px] text-[#00FF41] font-mono">
                    Create a CoFHE permit to decrypt your balance
                  </span>
                </div>
              )}

              {fheState === 'connecting' && (
                <div className="mt-3 flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[10px] text-[rgba(255,255,255,0.3)] font-mono">Connecting to CoFHE network...</span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowSendInput(v => !v)}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-sm bg-[#00FF41] hover:bg-[rgba(0,255,65,0.85)] active:scale-[0.98] transition-all font-mono font-bold text-sm text-black"
              >
                Send
              </button>
              <button
                disabled
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-sm border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] font-mono font-bold text-sm text-[rgba(255,255,255,0.3)] cursor-not-allowed"
              >
                Receive
              </button>
            </div>

            {/* Send recipient input */}
            {showSendInput && (
              <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(6,8,15,0.85)] p-5 flex flex-col gap-3">
                <label className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">
                  Recipient
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-0 rounded-sm border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] focus-within:border-[#00FF41] transition-all">
                    <input
                      placeholder="alice"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSendNavigate(); }}
                      className="flex-1 py-2.5 px-3 bg-transparent text-white font-mono text-sm focus:outline-none placeholder-[rgba(255,255,255,0.2)]"
                    />
                    <span className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono pr-3">.dust</span>
                  </div>
                  <button
                    onClick={handleSendNavigate}
                    disabled={!recipient.trim()}
                    className={`px-4 py-2.5 rounded-sm font-mono text-[11px] font-semibold tracking-wider transition-all ${
                      recipient.trim()
                        ? "border border-[#00FF41]/30 bg-[#00FF41]/10 text-[#00FF41] cursor-pointer hover:bg-[#00FF41]/15 hover:border-[#00FF41]"
                        : "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.3)] cursor-not-allowed"
                    }`}
                  >
                    PAY
                  </button>
                </div>
              </div>
            )}

            {/* Your dust name */}
            {dustName && (
              <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(6,8,15,0.85)] p-4 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider block">Your Address</span>
                  <span className="text-sm font-semibold text-white font-mono">{dustName}</span>
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(dustName)}
                  className="text-[10px] text-[#00FF41] font-mono border border-[#00FF41]/20 rounded-sm px-2 py-1 hover:bg-[#00FF41]/10 transition-all cursor-pointer"
                >
                  COPY
                </button>
              </div>
            )}

            {/* Recent Payments */}
            <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(6,8,15,0.85)] p-5">
              <div className="flex justify-between items-start mb-3">
                <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">
                  Incoming Payments
                </span>
                <button
                  onClick={scan}
                  disabled={isScanning}
                  className="text-[10px] text-[#00FF41] font-mono cursor-pointer bg-transparent border border-[#00FF41]/20 rounded-sm px-2 py-1 hover:bg-[#00FF41]/10 transition-all disabled:opacity-50 disabled:cursor-wait"
                >
                  {isScanning ? "SCANNING..." : "SCAN"}
                </button>
              </div>

              {isScanning && payments.length === 0 && (
                <div className="flex items-center gap-2 py-3">
                  <div className="w-3 h-3 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono">Scanning for incoming payments...</span>
                </div>
              )}

              {scanError && <span className="text-[11px] text-[#ef4444] font-mono">{scanError}</span>}

              {!isScanning && !scanError && payments.length === 0 && (
                <span className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono">No incoming payments found</span>
              )}

              {payments.length > 0 && (
                <div className="flex flex-col gap-2">
                  {payments.map((payment) => (
                    <div key={payment.txHash} className="flex items-center justify-between py-2 px-3 rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] text-white font-mono">
                          {payment.stealthAddress.slice(0, 6)}...{payment.stealthAddress.slice(-4)}
                        </span>
                        <span className="text-[9px] text-[rgba(0,255,65,0.5)] font-mono">Encrypted USDC</span>
                      </div>
                      <a
                        href={`https://sepolia.arbiscan.io/tx/${payment.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-[rgba(0,255,65,0.6)] font-mono hover:text-[#00FF41] transition-colors no-underline"
                      >
                        {payment.txHash.slice(0, 6)}...{payment.txHash.slice(-4)}
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Faucet */}
            <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(6,8,15,0.85)] p-5">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">Testnet Faucet</span>
                  <span className="text-sm font-semibold text-white font-mono block mt-1">Get Test USDC</span>
                </div>
                <span className="text-[10px] text-[rgba(255,255,255,0.3)] font-mono">1,000 USDC per mint</span>
              </div>
              <button
                onClick={handleMint}
                disabled={isMinting || isMintConfirming}
                className={`w-full py-3 rounded-sm font-mono text-xs font-semibold tracking-wider flex items-center justify-center gap-2 transition-all ${
                  isMintSuccess
                    ? "border border-[#00FF41]/30 bg-[#00FF41]/[0.05] text-[#00FF41]"
                    : isMinting || isMintConfirming
                      ? "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.3)] cursor-wait"
                      : "border border-[#00FF41]/30 bg-[#00FF41]/[0.05] text-[#00FF41] cursor-pointer hover:border-[#00FF41] hover:bg-[#00FF41]/[0.1]"
                }`}
              >
                {isMinting ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-transparent rounded-full animate-spin" /> MINTING...</>
                ) : isMintConfirming ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-transparent rounded-full animate-spin" /> CONFIRMING...</>
                ) : isMintSuccess ? (
                  "MINTED 1,000 USDC"
                ) : (
                  "MINT 1,000 USDC"
                )}
              </button>
            </div>

            {/* Info */}
            <div className="rounded-sm border border-[rgba(0,255,65,0.08)] bg-[rgba(0,255,65,0.02)] p-4">
              <div className="flex gap-3">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00FF41" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span className="text-[11px] text-[rgba(255,255,255,0.45)] font-mono">
                  Stealth addresses hide who receives funds. FHE encrypts how much. Two orthogonal privacy layers on Arbitrum Sepolia.
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function DashboardPageClient() {
  return (
    <FHEProviderWrapper>
      <DashboardContent />
    </FHEProviderWrapper>
  );
}
