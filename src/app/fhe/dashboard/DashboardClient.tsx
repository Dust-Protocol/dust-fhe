"use client";

import React, { useState } from "react";
import { useAccount, useConnect, useChainId, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { injected } from "wagmi/connectors";
import { useFHEInit, useFHEBalance, useFHEStealthScanner } from "@/hooks/fhe";
import { FHE_CHAIN_ID, FHE_CONTRACTS, MockUSDCABI } from "@/lib/fhe";
import { useAuth } from "@/contexts/AuthContext";
import { DustLogo } from "@/components/DustLogo";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatUnits, parseUnits } from "viem";

export default function DashboardClient() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { stealthKeys } = useAuth();
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
    <div className="flex flex-col">
      {/* Content */}
      <div className="flex-1 flex justify-center px-4 py-10">
        <div className="w-full max-w-[600px] flex flex-col gap-6 items-center">

          {/* Testnet banner */}
          <div className="w-full max-w-[600px] px-3 py-1.5 rounded-sm bg-[rgba(255,200,0,0.06)] border border-[rgba(255,200,0,0.15)] text-center">
            <span className="text-[10px] text-[#eab308] font-mono tracking-wider">
              ARBITRUM SEPOLIA TESTNET
            </span>
          </div>

          {!isConnected ? (
            <div className="rounded-md border border-[rgba(255,255,255,0.1)] bg-[#06080F] p-8 flex flex-col items-center gap-5">
              <DustLogo size={40} color="#a78bfa" />
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-lg font-bold text-white font-mono">FHE Stealth Payments</span>
                <span className="text-[11px] text-[rgba(255,255,255,0.35)] font-mono text-center max-w-[300px]">
                  Send and receive private payments with fully homomorphic encryption. Amount hidden — only the recipient can decrypt.
                </span>
              </div>
              <button
                onClick={() => connect({ connector: injected() })}
                className="w-full max-w-[280px] py-3 rounded-sm border border-purple-500/30 bg-purple-500/[0.05] text-purple-400 font-mono text-xs font-semibold tracking-wider flex items-center justify-center gap-2 cursor-pointer hover:border-purple-400 hover:bg-purple-500/[0.1] transition-all"
              >
                CONNECT WALLET
              </button>
            </div>
          ) : chainMismatch ? (
            <div className="rounded-md border border-[rgba(255,255,255,0.1)] bg-[#06080F] p-8 flex flex-col items-center gap-4">
              <span className="text-sm text-[rgba(255,255,255,0.5)] font-mono">
                Switch to Arbitrum Sepolia to use FHE features
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
              <div className="rounded-md border border-[rgba(255,255,255,0.1)] bg-[#06080F] p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">
                      Encrypted Balance
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      <span className="text-[10px] text-purple-400/60 font-mono">Decrypted client-side</span>
                    </div>
                  </div>
                  <button
                    onClick={refetch}
                    disabled={balanceLoading}
                    className="text-[10px] text-purple-400 font-mono cursor-pointer bg-transparent border border-purple-500/20 rounded-sm px-2 py-1 hover:bg-purple-500/10 transition-all disabled:opacity-50 disabled:cursor-wait"
                  >
                    {balanceLoading ? "..." : "REFRESH"}
                  </button>
                </div>

                <div className="flex items-baseline gap-2">
                  {balanceLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-[rgba(255,255,255,0.3)] font-mono">
                        Loading...
                      </span>
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
                  <div className="mt-3 px-3 py-2 rounded-sm border border-purple-500/20 bg-purple-500/[0.04]">
                    <span className="text-[10px] text-purple-400 font-mono">
                      Create a CoFHE permit to decrypt your balance
                    </span>
                  </div>
                )}

                {fheState === 'connecting' && (
                  <div className="mt-3 flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-[10px] text-[rgba(255,255,255,0.3)] font-mono">
                      Connecting to CoFHE network...
                    </span>
                  </div>
                )}
              </div>

              {/* Recent Payments */}
              <div className="rounded-md border border-[rgba(255,255,255,0.1)] bg-[#06080F] p-6">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">
                    Recent Payments
                  </span>
                  <button
                    onClick={scan}
                    disabled={isScanning}
                    className="text-[10px] text-purple-400 font-mono cursor-pointer bg-transparent border border-purple-500/20 rounded-sm px-2 py-1 hover:bg-purple-500/10 transition-all disabled:opacity-50 disabled:cursor-wait"
                  >
                    {isScanning ? "SCANNING..." : "SCAN"}
                  </button>
                </div>

                {isScanning && payments.length === 0 && (
                  <div className="flex items-center gap-2 py-3">
                    <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono">
                      Scanning for incoming payments...
                    </span>
                  </div>
                )}

                {scanError && (
                  <span className="text-[11px] text-[#ef4444] font-mono">{scanError}</span>
                )}

                {!isScanning && !scanError && payments.length === 0 && (
                  <span className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono">
                    No incoming payments found
                  </span>
                )}

                {payments.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {payments.map((payment) => (
                      <div
                        key={payment.txHash}
                        className="flex items-center justify-between py-2 px-3 rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[11px] text-white font-mono">
                            {payment.stealthAddress.slice(0, 6)}...{payment.stealthAddress.slice(-4)}
                          </span>
                          <span className="text-[9px] text-purple-400/60 font-mono">
                            Encrypted USDC
                          </span>
                        </div>
                        <a
                          href={`https://sepolia.arbiscan.io/tx/${payment.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[9px] text-purple-400 font-mono hover:text-purple-300 transition-colors no-underline"
                        >
                          {payment.txHash.slice(0, 6)}...{payment.txHash.slice(-4)}
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Get Test USDC */}
              <div className="rounded-md border border-[rgba(255,255,255,0.1)] bg-[#06080F] p-6">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">
                      Testnet Faucet
                    </span>
                    <div className="mt-1">
                      <span className="text-sm font-semibold text-white font-mono">Get Test USDC</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-[rgba(255,255,255,0.3)] font-mono">1,000 USDC per mint</span>
                </div>
                <button
                  onClick={handleMint}
                  disabled={isMinting || isMintConfirming}
                  className={`w-full py-3 rounded-sm font-mono text-xs font-semibold tracking-wider flex items-center justify-center gap-2 transition-all ${
                    isMintSuccess
                      ? "border border-green-500/30 bg-green-500/[0.05] text-green-400"
                      : isMinting || isMintConfirming
                        ? "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.3)] cursor-wait"
                        : "border border-[#00FF41]/30 bg-[#00FF41]/[0.05] text-[#00FF41] cursor-pointer hover:border-[#00FF41] hover:bg-[#00FF41]/[0.1] hover:shadow-[0_0_15px_rgba(0,255,65,0.15)]"
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

              {/* Quick Actions */}
              <div className="grid grid-cols-2 gap-3">
                <div
                  onClick={() => setShowSendInput(v => !v)}
                  className="rounded-md border border-[rgba(255,255,255,0.1)] bg-[#06080F] p-5 flex flex-col gap-3 hover:border-purple-500/30 transition-all cursor-pointer group"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-purple-400 transition-colors">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  <div>
                    <span className="text-sm font-semibold text-white font-mono block">Send</span>
                    <span className="text-[10px] text-[rgba(255,255,255,0.3)] font-mono">
                      Encrypted stealth payment
                    </span>
                  </div>
                </div>

                <div className="rounded-md border border-[rgba(255,255,255,0.06)] bg-[#06080F] p-5 flex flex-col gap-3 opacity-50">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                  </svg>
                  <div>
                    <span className="text-sm font-semibold text-[rgba(255,255,255,0.4)] font-mono block">Receive</span>
                    <span className="text-[10px] text-[rgba(255,255,255,0.2)] font-mono">
                      Coming in Wave 2
                    </span>
                  </div>
                </div>
              </div>

              {/* Send recipient input */}
              {showSendInput && (
                <div className="rounded-md border border-purple-500/20 bg-[#06080F] p-5 flex flex-col gap-3">
                  <label className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">
                    Recipient Name
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1 flex items-center gap-0 rounded-sm border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] focus-within:border-purple-400 transition-all">
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
                          ? "border border-purple-500/30 bg-purple-500/10 text-purple-400 cursor-pointer hover:bg-purple-500/15 hover:border-purple-400"
                          : "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.3)] cursor-not-allowed"
                      }`}
                    >
                      PAY
                    </button>
                  </div>
                </div>
              )}

              {/* Info */}
              <div className="rounded-md border border-[rgba(139,92,246,0.1)] bg-[rgba(139,92,246,0.02)] p-4">
                <div className="flex gap-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-[rgba(255,255,255,0.5)] font-mono">
                      FHE stealth payments combine stealth addresses (hiding who) with fully homomorphic encryption (hiding how much). Balances are encrypted on-chain and decrypted only client-side.
                    </span>
                    <span className="text-[10px] text-purple-400/50 font-mono">
                      Arbitrum Sepolia Testnet
                    </span>
                  </div>
                </div>
              </div>

              {/* Wallet address */}
              {address && (
                <div className="text-center">
                  <span className="text-[10px] text-[rgba(255,255,255,0.2)] font-mono">
                    {address.slice(0, 6)}...{address.slice(-4)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export { DashboardClient };
