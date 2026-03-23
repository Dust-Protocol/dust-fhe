"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/contexts/AuthContext";
import { UnifiedBalanceCard } from "@/components/dashboard/UnifiedBalanceCard";
import { PersonalLinkCard } from "@/components/dashboard/PersonalLinkCard";
import { SendIcon, ArrowDownLeftIcon } from "@/components/stealth/icons";
import { ReceiveModal } from "@/components/dashboard/ReceiveModal";
import { useReadContract } from 'wagmi';
import { useRouter } from 'next/navigation';
import { formatUnits } from 'viem';
import { FHE_CONTRACTS, MockUSDCABI, FHE_CHAIN_ID } from '@/lib/fhe';
import { useFHEBalance, useFHEStealthScanner } from '@/hooks/fhe';

const FHEProviderWrapper = dynamic(() => import("@/app/fhe/FHEProviderWrapper"), { ssr: false });

function DashboardContent() {
  const { stealthKeys, metaAddress, ownedNames, isNamesSettled, address } = useAuth();
  const router = useRouter();

  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [showSendInput, setShowSendInput] = useState(false);

  const dustName = ownedNames.length > 0 ? `${ownedNames[0].name}.dust` : null;
  const payPath = ownedNames.length > 0 ? `/pay/${ownedNames[0].name}` : "";

  const { data: rawUsdcBalance, isFetching: usdcFetching, refetch: refetchUsdc } = useReadContract({
    address: FHE_CONTRACTS.mockUSDC,
    abi: MockUSDCABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: FHE_CHAIN_ID,
  });
  const usdcBalance = rawUsdcBalance !== undefined ? formatUnits(rawUsdcBalance as bigint, 6) : null;

  const { balance: encBalance, isLoading: encLoading, refetch: refetchEnc } = useFHEBalance();
  const encryptedUsdcBalance = encBalance !== null ? formatUnits(encBalance, 6) : null;

  const { payments, isScanning, scan, error: scanError } = useFHEStealthScanner(stealthKeys, address);

  const handleRefresh = useCallback(() => {
    refetchUsdc();
    refetchEnc();
    scan();
  }, [refetchUsdc, refetchEnc, scan]);

  const handleSendNavigate = () => {
    const name = recipient.trim().replace(/\.dust$/i, '');
    if (!name) return;
    router.push(`/fhe/pay/${encodeURIComponent(name)}`);
  };

  return (
    <div className="px-3.5 py-7 md:px-6 md:py-7 max-w-[640px] mx-auto">
      <div className="flex flex-col gap-4">
        <div className="text-center mb-2">
          <h1 className="text-2xl md:text-3xl font-bold tracking-widest text-white font-mono mb-1">
            STEALTH_WALLET
          </h1>
          <p className="text-xs text-[rgba(255,255,255,0.4)] font-mono tracking-wide">
            Privacy-first asset management
          </p>
        </div>

        <UnifiedBalanceCard
          total={0}
          stealthTotal={0}
          claimTotal={0}
          unclaimedCount={payments.length}
          isScanning={isScanning}
          isLoading={usdcFetching}
          onRefresh={handleRefresh}
          usdcBalance={usdcBalance}
          usdcLoading={usdcFetching}
          encryptedUsdcBalance={encryptedUsdcBalance}
          encryptedUsdcLoading={encLoading}
        />

        <div className="flex gap-2.5">
          <button
            onClick={() => setShowSendInput(v => !v)}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-sm bg-[#00FF41] hover:bg-[rgba(0,255,65,0.85)] active:scale-[0.98] transition-all font-mono font-bold text-sm text-black"
          >
            <SendIcon size={17} color="#000" />
            Send
          </button>
          <button
            onClick={() => setShowReceiveModal(true)}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-sm border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.05)] active:scale-[0.98] transition-all font-mono font-bold text-sm text-white"
          >
            <ArrowDownLeftIcon size={17} color="rgba(255,255,255,0.7)" />
            Receive
          </button>
        </div>

        {/* Send recipient input */}
        {showSendInput && (
          <div className="rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5 flex flex-col gap-3">
            <label className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">
              Recipient
            </label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center rounded-sm border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] focus-within:border-[#00FF41] transition-all">
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

        {/* Incoming FHE Payments */}
        <div className="rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5">
          <div className="flex justify-between items-start mb-3">
            <span className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
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
                <div key={payment.txHash} className="flex items-center justify-between py-2 px-3 rounded-sm border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)]">
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

        <PersonalLinkCard ownedNames={ownedNames} metaAddress={metaAddress} isNamesSettled={isNamesSettled} />

        <ReceiveModal isOpen={showReceiveModal} onClose={() => setShowReceiveModal(false)} dustName={dustName} payPath={payPath} />
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
