"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/contexts/AuthContext";
import { UnifiedBalanceCard } from "@/components/dashboard/UnifiedBalanceCard";
import { PersonalLinkCard } from "@/components/dashboard/PersonalLinkCard";
import { SendIcon, ArrowDownLeftIcon } from "@/components/stealth/icons";
import { ReceiveModal } from "@/components/dashboard/ReceiveModal";
import { V2PoolCard } from "@/components/dustpool/V2PoolCard";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { useRouter } from 'next/navigation';
import { formatUnits, parseUnits, isAddress } from 'viem';
import { FHE_CONTRACTS, MockUSDCABI, ConfidentialTokenABI, FHENameRegistryABI, FHE_CHAIN_ID } from '@/lib/fhe';
import { useFHEBalance, useFHEStealthScanner, useFHEStealthClaim } from '@/hooks/fhe';
import type { ClaimStep } from '@/hooks/fhe/useFHEStealthClaim';

const FHEProviderWrapper = dynamic(() => import("@/app/fhe/FHEProviderWrapper"), { ssr: false });

const CLAIM_STEP_LABELS: Record<ClaimStep, string> = {
  idle: "",
  funding: "Funding gas...",
  decrypting: "Decrypting...",
  encrypting: "Encrypting...",
  transferring: "Transferring...",
  confirming: "Confirming...",
  success: "Claimed!",
  error: "Failed",
};

type RecipientStatus = 'idle' | 'checking' | 'valid' | 'invalid';

function DashboardContent() {
  const { stealthKeys, metaAddress, ownedNames, isNamesSettled, address, activeChainId } = useAuth();
  const router = useRouter();
  const publicClient = usePublicClient({ chainId: FHE_CHAIN_ID });

  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [showSendInput, setShowSendInput] = useState(false);
  const [recipientStatus, setRecipientStatus] = useState<RecipientStatus>('idle');
  const [depositAmount, setDepositAmount] = useState("");
  const [showDeposit, setShowDeposit] = useState(false);
  const [claimingPayment, setClaimingPayment] = useState<string | null>(null);

  const dustName = ownedNames.length > 0 ? `${ownedNames[0].name}.dust` : null;
  const payPath = ownedNames.length > 0 ? `/pay/${ownedNames[0].name}` : "";

  const isAddressMode = recipient.startsWith("0x");

  const { data: rawUsdcBalance, isFetching: usdcFetching, refetch: refetchUsdc } = useReadContract({
    address: FHE_CONTRACTS.mockUSDC,
    abi: MockUSDCABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    chainId: FHE_CHAIN_ID,
  });
  const usdcBalance = rawUsdcBalance !== undefined ? formatUnits(rawUsdcBalance as bigint, 6) : null;

  const { balance: encBalance, isLoading: encLoading, refetch: refetchEnc } = useFHEBalance();
  const encryptedUsdcBalance = encBalance !== null ? formatUnits(encBalance, 6) : null;

  const { payments, isScanning, scan, error: scanError } = useFHEStealthScanner(stealthKeys, address);
  const { claim, step: claimStep, error: claimError, txHash: claimTxHash, reset: resetClaim } = useFHEStealthClaim();

  // Deposit: approve + deposit
  const { writeContract: writeApprove, data: approveTxHash, isPending: isApproving, reset: resetApprove } = useWriteContract();
  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { writeContract: writeDeposit, data: depositTxHash, isPending: isDepositing, reset: resetDeposit } = useWriteContract();
  const { isLoading: isDepositConfirming, isSuccess: isDepositSuccess } = useWaitForTransactionReceipt({ hash: depositTxHash });

  // Auto-trigger deposit after approve confirms
  const depositTriggeredRef = useRef(false);
  useEffect(() => {
    if (isApproveSuccess && !depositTriggeredRef.current && depositAmount) {
      depositTriggeredRef.current = true;
      const amt = parseUnits(depositAmount, 6);
      writeDeposit({
        address: FHE_CONTRACTS.confidentialToken,
        abi: ConfidentialTokenABI,
        functionName: 'deposit',
        args: [amt],
        chainId: FHE_CHAIN_ID,
      });
    }
  }, [isApproveSuccess, depositAmount, writeDeposit]);

  // Refresh balances after deposit success
  useEffect(() => {
    if (isDepositSuccess) {
      refetchUsdc();
      refetchEnc();
    }
  }, [isDepositSuccess, refetchUsdc, refetchEnc]);

  // Recipient validation with debounce
  useEffect(() => {
    if (!recipient.trim()) { setRecipientStatus('idle'); return; }

    const timer = setTimeout(async () => {
      if (isAddressMode) {
        setRecipientStatus(isAddress(recipient) ? 'valid' : 'invalid');
      } else {
        setRecipientStatus('checking');
        try {
          if (!publicClient) { setRecipientStatus('invalid'); return; }
          const result = await publicClient.readContract({
            address: FHE_CONTRACTS.nameRegistry,
            abi: FHENameRegistryABI,
            functionName: 'resolveName',
            args: [recipient.replace(/\.dust$/i, '')],
          });
          const [spendKey] = result as [string, string];
          setRecipientStatus(spendKey && spendKey !== '0x' ? 'valid' : 'invalid');
        } catch {
          setRecipientStatus('invalid');
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [recipient, isAddressMode, publicClient]);

  const handleRefresh = useCallback(() => {
    refetchUsdc();
    refetchEnc();
    scan();
  }, [refetchUsdc, refetchEnc, scan]);

  const handleSendNavigate = () => {
    const input = recipient.trim();
    if (!input) return;
    if (isAddressMode) {
      router.push(`/fhe/pay/${encodeURIComponent(input)}`);
    } else {
      const name = input.replace(/\.dust$/i, '');
      router.push(`/fhe/pay/${encodeURIComponent(name)}`);
    }
  };

  const handleDeposit = () => {
    if (!depositAmount || !address) return;
    depositTriggeredRef.current = false;
    resetApprove();
    resetDeposit();
    const amt = parseUnits(depositAmount, 6);
    writeApprove({
      address: FHE_CONTRACTS.mockUSDC,
      abi: MockUSDCABI,
      functionName: 'approve',
      args: [FHE_CONTRACTS.confidentialToken, amt],
      chainId: FHE_CHAIN_ID,
    });
  };

  const handleClaim = async (stealthPrivateKey: string, stealthAddress: string) => {
    setClaimingPayment(stealthAddress);
    resetClaim();
    await claim(stealthPrivateKey, stealthAddress);
  };

  const depositStepLabel = isApproving ? "Approving..." :
    isApproveConfirming ? "Confirming approval..." :
    isDepositing ? "Depositing..." :
    isDepositConfirming ? "Encrypting balance..." :
    isDepositSuccess ? "Deposited!" : "";

  const isDepositBusy = isApproving || isApproveConfirming || isDepositing || isDepositConfirming;

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

        {/* Deposit USDC → Encrypted */}
        <div className="rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
              DEPOSIT_USDC
            </span>
            <button
              onClick={() => setShowDeposit(v => !v)}
              className="text-[10px] text-[#00FF41] font-mono cursor-pointer"
            >
              {showDeposit ? "HIDE" : "SHOW"}
            </button>
          </div>
          {showDeposit && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] text-[rgba(255,255,255,0.35)] font-mono">
                Wrap USDC into encrypted balance for private transfers
              </p>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center rounded-sm border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] focus-within:border-[#00FF41] transition-all">
                  <input
                    type="number"
                    placeholder="1000"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="flex-1 py-2.5 px-3 bg-transparent text-white font-mono text-sm focus:outline-none placeholder-[rgba(255,255,255,0.2)] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono pr-3">USDC</span>
                </div>
                <button
                  onClick={handleDeposit}
                  disabled={!depositAmount || isDepositBusy || parseFloat(depositAmount) <= 0}
                  className={`px-4 py-2.5 rounded-sm font-mono text-[11px] font-semibold tracking-wider transition-all ${
                    isDepositSuccess
                      ? "border border-[#00FF41]/30 bg-[#00FF41]/10 text-[#00FF41]"
                      : isDepositBusy
                        ? "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.3)] cursor-wait"
                        : depositAmount && parseFloat(depositAmount) > 0
                          ? "border border-[#00FF41]/30 bg-[#00FF41]/10 text-[#00FF41] cursor-pointer hover:bg-[#00FF41]/15 hover:border-[#00FF41]"
                          : "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.3)] cursor-not-allowed"
                  }`}
                >
                  {isDepositSuccess ? "DONE" : isDepositBusy ? "..." : "DEPOSIT"}
                </button>
              </div>
              {depositStepLabel && (
                <div className="flex items-center gap-2">
                  {isDepositBusy && <div className="w-3 h-3 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />}
                  <span className={`text-[10px] font-mono ${isDepositSuccess ? "text-[#00FF41]" : "text-[rgba(255,255,255,0.4)]"}`}>
                    {depositStepLabel}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

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

        {/* Send recipient input — supports .dust names and 0x addresses */}
        {showSendInput && (
          <div className="rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5 flex flex-col gap-3">
            <label className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">
              Recipient
            </label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center rounded-sm border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] focus-within:border-[#00FF41] transition-all">
                <input
                  placeholder={isAddressMode ? "0x..." : "alice"}
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && recipientStatus === 'valid') handleSendNavigate(); }}
                  className="flex-1 py-2.5 px-3 bg-transparent text-white font-mono text-sm focus:outline-none placeholder-[rgba(255,255,255,0.2)]"
                />
                {!isAddressMode && (
                  <span className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono pr-3">.dust</span>
                )}
                {recipientStatus === 'checking' && (
                  <div className="w-3 h-3 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin mr-3" />
                )}
                {recipientStatus === 'valid' && (
                  <span className="text-[#00FF41] mr-3 text-sm">✓</span>
                )}
                {recipientStatus === 'invalid' && (
                  <span className="text-[#ef4444] mr-3 text-sm">✗</span>
                )}
              </div>
              <button
                onClick={handleSendNavigate}
                disabled={recipientStatus !== 'valid'}
                className={`px-4 py-2.5 rounded-sm font-mono text-[11px] font-semibold tracking-wider transition-all ${
                  recipientStatus === 'valid'
                    ? "border border-[#00FF41]/30 bg-[#00FF41]/10 text-[#00FF41] cursor-pointer hover:bg-[#00FF41]/15 hover:border-[#00FF41]"
                    : "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.3)] cursor-not-allowed"
                }`}
              >
                PAY
              </button>
            </div>
            {recipientStatus === 'invalid' && recipient.trim() && (
              <span className="text-[10px] text-[#ef4444] font-mono">
                {isAddressMode ? "Invalid address" : `${recipient.replace(/\.dust$/i, '')}.dust not found`}
              </span>
            )}
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
              {payments.map((payment) => {
                const isClaiming = claimingPayment === payment.stealthAddress;
                const claimLabel = isClaiming ? CLAIM_STEP_LABELS[claimStep] : "";
                const isClaimBusy = isClaiming && claimStep !== 'idle' && claimStep !== 'success' && claimStep !== 'error';
                const isClaimDone = isClaiming && claimStep === 'success';
                const isClaimError = isClaiming && claimStep === 'error';

                return (
                  <div key={payment.txHash} className="flex items-center justify-between py-2.5 px-3 rounded-sm border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)]">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-white font-mono">
                        {payment.stealthAddress.slice(0, 6)}...{payment.stealthAddress.slice(-4)}
                      </span>
                      <span className="text-[9px] text-[rgba(0,255,65,0.5)] font-mono">
                        {claimLabel || "Encrypted USDC"}
                      </span>
                      {isClaimError && claimError && (
                        <span className="text-[9px] text-[#ef4444] font-mono">{claimError}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={`https://sepolia.arbiscan.io/tx/${payment.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-[rgba(0,255,65,0.6)] font-mono hover:text-[#00FF41] transition-colors no-underline"
                      >
                        {payment.txHash.slice(0, 6)}...
                      </a>
                      {isClaimDone ? (
                        <span className="text-[9px] text-[#00FF41] font-mono font-bold">CLAIMED</span>
                      ) : (
                        <button
                          onClick={() => handleClaim(payment.stealthPrivateKey, payment.stealthAddress)}
                          disabled={isClaimBusy}
                          className={`text-[9px] font-mono font-semibold px-2 py-1 rounded-sm transition-all ${
                            isClaimBusy
                              ? "text-[rgba(255,255,255,0.3)] border border-[rgba(255,255,255,0.06)] cursor-wait"
                              : "text-[#00FF41] border border-[#00FF41]/20 cursor-pointer hover:bg-[#00FF41]/10"
                          }`}
                        >
                          {isClaimBusy ? "..." : "CLAIM"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <V2PoolCard chainId={activeChainId} />

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
