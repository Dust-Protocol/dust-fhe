"use client";

import React, { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react";
import { useAccount, useConnect, useChainId, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { useFHEStealthSend, type SendStep } from "@/hooks/fhe";
import { useFHEInit } from "@/hooks/fhe";
import { FHE_CHAIN_ID } from "@/lib/fhe";
import { DustLogo } from "@/components/DustLogo";
import Link from "next/link";

const STEP_LABELS: Record<SendStep, string> = {
  idle: "",
  resolving: "Finding recipient...",
  deriving: "Generating private address...",
  "approving-underlying": "Preparing payment...",
  depositing: "Encrypting funds...",
  encrypting: "Securing with FHE...",
  "approving-stealth": "Authorizing transfer...",
  sending: "Sending privately...",
  confirming: "Confirming on-chain...",
  success: "Payment sent!",
  error: "Transaction failed",
};

const STEP_ORDER: SendStep[] = [
  "resolving", "deriving", "approving-underlying", "depositing",
  "encrypting", "approving-stealth", "sending", "confirming",
];

export default function FHEPayPageClient({ name }: { name: string }) {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const walletChainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { state: fheState, error: fheError } = useFHEInit();
  const { sendEncryptedToStealth, step, isLoading, error: sendError, reset } = useFHEStealthSend();

  const [amount, setAmount] = useState("");
  const [view, setView] = useState<"input" | "confirm" | "progress" | "success">("input");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [resolveError, setResolveError] = useState(false);
  const resolveCheckedRef = useRef(false);

  const fullName = `${name}.dust`;
  const chainMismatch = isConnected && walletChainId !== FHE_CHAIN_ID;

  // Verify name exists on FHENameRegistry
  useEffect(() => {
    if (resolveCheckedRef.current) return;
    resolveCheckedRef.current = true;
    fetch(`/api/fhe/resolve-name/${encodeURIComponent(name)}`)
      .then(res => { if (!res.ok) setResolveError(true); })
      .catch(() => setResolveError(true));
  }, [name]);

  // Track send step transitions
  useEffect(() => {
    if (step === "success" && view === "progress") {
      setView("success");
    }
    if (step === "error" && view === "progress") {
      setView("confirm");
    }
  }, [step, view]);

  const handlePreview = () => {
    if (!amount || parseFloat(amount) <= 0) return;
    setView("confirm");
  };

  const handleSwitchChain = useCallback(async () => {
    setIsSwitching(true);
    try {
      await switchChain({ chainId: FHE_CHAIN_ID });
    } catch (e) {
      console.error("[fhe-pay] Chain switch failed:", e);
    } finally {
      setIsSwitching(false);
    }
  }, [switchChain]);

  const handleSend = async () => {
    setView("progress");
    const hash = await sendEncryptedToStealth(name, amount);
    if (hash) {
      setTxHash(hash);
    }
  };

  const handleReset = () => {
    setView("input");
    setAmount("");
    setTxHash(null);
    reset();
  };

  const isSuccess = view === "success";

  return (
    <div className="flex flex-col">
      {/* Content */}
      <div className="flex-1 flex justify-center px-4 py-10">
        <div className="w-full max-w-[440px]">
          <div className="flex flex-col gap-4">
            {/* Main Card */}
            <div className="relative">
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.1)]" />
              <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.1)]" />
              <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.1)]" />
              <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.1)]" />

              <div
                className={`w-full rounded-md border overflow-hidden transition-all duration-300 ${
                  isSuccess
                    ? "border-[rgba(34,197,94,0.3)] bg-[#06080F]"
                    : "border-[rgba(255,255,255,0.1)] bg-[#06080F]"
                }`}
                style={{ boxShadow: isSuccess ? "0 0 30px rgba(34,197,94,0.08)" : "0 4px 24px rgba(0,0,0,0.3)" }}
              >
                {/* Recipient Header */}
                <div className={`px-6 pt-7 pb-5 text-center border-b transition-all duration-300 ${
                  isSuccess ? "border-[rgba(34,197,94,0.15)]" : "border-[rgba(255,255,255,0.06)]"
                }`}>
                  <div className="flex flex-col items-center gap-3">
                    <div className={`p-3 rounded-sm transition-colors duration-300 ${
                      isSuccess ? "bg-[rgba(34,197,94,0.08)]" : "bg-[rgba(139,92,246,0.06)]"
                    }`}>
                      <DustLogo size={28} color={isSuccess ? "#22c55e" : "#a78bfa"} />
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <span className={`text-xl font-bold font-mono tracking-tight transition-colors duration-300 ${
                        isSuccess ? "text-green-400" : "text-purple-400"
                      }`}>
                        {fullName}
                      </span>
                      <span className="text-[11px] text-[rgba(255,255,255,0.35)] font-mono">
                        {isSuccess ? "Encrypted payment completed" : "Send an FHE-encrypted payment"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Body */}
                <div className="p-6">
                  {resolveError ? (
                    <ResolveErrorView fullName={fullName} />
                  ) : !isConnected ? (
                    <ConnectView onConnect={() => connect({ connector: injected() })} />
                  ) : fheState === 'wrong-chain' || chainMismatch ? (
                    <ChainSwitchView isSwitching={isSwitching} onSwitch={handleSwitchChain} />
                  ) : fheState === 'connecting' ? (
                    <LoadingView label="Connecting to CoFHE network..." />
                  ) : fheState === 'error' ? (
                    <ErrorView message={fheError ?? "FHE initialization failed"} />
                  ) : view === "input" ? (
                    <InputView amount={amount} setAmount={setAmount} onPreview={handlePreview} />
                  ) : view === "confirm" ? (
                    <ConfirmView
                      amount={amount}
                      fullName={fullName}
                      isLoading={isLoading}
                      onBack={() => setView("input")}
                      onSend={handleSend}
                    />
                  ) : view === "progress" ? (
                    <ProgressView step={step} />
                  ) : (
                    <SuccessView
                      amount={amount}
                      fullName={fullName}
                      txHash={txHash}
                      onSendAnother={handleReset}
                    />
                  )}

                  {sendError && view !== "progress" && (
                    <div className="flex gap-2 items-center p-3 mt-3 rounded-sm bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.2)]">
                      <span className="text-[11px] text-[#ef4444] font-mono">{sendError}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-center pt-1">
              <Link href="/fhe/dashboard" className="no-underline">
                <span className="text-[11px] text-[rgba(255,255,255,0.25)] font-mono cursor-pointer hover:text-[rgba(255,255,255,0.5)] transition-colors">
                  Pay someone else
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResolveErrorView({ fullName }: { fullName: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
      </svg>
      <span className="text-xs text-[#ef4444] font-mono">Could not resolve {fullName}</span>
      <span className="text-[10px] text-[rgba(255,255,255,0.3)] font-mono text-center">
        This name is not registered on the FHE Name Registry
      </span>
    </div>
  );
}

function ConnectView({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center gap-5 py-4">
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-sm font-bold text-white font-mono">Connect to send</span>
        <span className="text-[11px] text-[rgba(255,255,255,0.35)] font-mono text-center">
          Connect your wallet to send an encrypted payment
        </span>
      </div>
      <button
        onClick={onConnect}
        className="w-full py-3 rounded-sm border border-purple-500/30 bg-purple-500/[0.05] text-purple-400 font-mono text-xs font-semibold tracking-wider flex items-center justify-center gap-2 cursor-pointer hover:border-purple-400 hover:bg-purple-500/[0.1] transition-all"
      >
        CONNECT WALLET
      </button>
    </div>
  );
}

function ChainSwitchView({ isSwitching, onSwitch }: { isSwitching: boolean; onSwitch: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <span className="text-xs text-[rgba(255,255,255,0.5)] font-mono text-center">
        FHE payments require Arbitrum Sepolia
      </span>
      <button
        onClick={onSwitch}
        disabled={isSwitching}
        className="w-full py-3 rounded-sm border border-[rgba(255,200,0,0.3)] bg-[rgba(255,200,0,0.06)] text-[#FFC800] font-mono text-xs font-semibold tracking-wider flex items-center justify-center gap-2 cursor-pointer hover:bg-[rgba(255,200,0,0.1)] hover:border-[#FFC800] transition-all disabled:cursor-wait"
      >
        {isSwitching ? (
          <div className="w-3.5 h-3.5 border-2 border-[#FFC800] border-t-transparent rounded-full animate-spin" />
        ) : (
          "SWITCH TO ARBITRUM SEPOLIA"
        )}
      </button>
    </div>
  );
}

function LoadingView({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
      <span className="text-[11px] text-[rgba(255,255,255,0.35)] font-mono">{label}</span>
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <span className="text-xs text-[#ef4444] font-mono text-center">{message}</span>
    </div>
  );
}

function InputView({
  amount, setAmount, onPreview,
}: {
  amount: string; setAmount: (v: string) => void; onPreview: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono block mb-1.5">
          Network
        </label>
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-sm border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)]">
          <span className="text-xs text-white font-mono font-medium">Arbitrum Sepolia</span>
          <span className="text-[10px] text-[rgba(255,255,255,0.3)] ml-auto">ETH</span>
        </div>
      </div>

      <div>
        <label className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono block mb-1.5">
          Amount
        </label>
        <div className="flex gap-2 items-center">
          <input
            placeholder="0.00"
            type="number"
            step="any"
            min="0"
            value={amount}
            onKeyDown={(e) => { if (["-", "e", "E", "+"].includes(e.key)) e.preventDefault(); }}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const v = e.target.value;
              if (v === "" || parseFloat(v) >= 0) setAmount(v);
            }}
            className="flex-1 py-2.5 px-3 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] text-white font-mono text-sm font-semibold focus:outline-none focus:border-purple-400 focus:bg-[rgba(139,92,246,0.02)] placeholder-[rgba(255,255,255,0.2)] transition-all"
          />
          <div className="flex items-center gap-1.5 px-2.5 py-2.5 rounded-sm border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)]">
            <span className="text-[11px] text-white font-mono font-bold">USDC</span>
          </div>
        </div>
      </div>

      <button
        onClick={onPreview}
        disabled={!amount || parseFloat(amount) <= 0}
        className={`w-full py-3 rounded-sm font-mono text-xs font-semibold tracking-wider flex items-center justify-center gap-2 transition-all ${
          amount && parseFloat(amount) > 0
            ? "border border-purple-500/30 bg-purple-500/10 text-purple-400 cursor-pointer hover:bg-purple-500/15 hover:border-purple-400 hover:shadow-[0_0_15px_rgba(139,92,246,0.15)]"
            : "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.3)] cursor-not-allowed"
        }`}
      >
        PREVIEW PAYMENT
      </button>
    </div>
  );
}

function ConfirmView({
  amount, fullName, isLoading, onBack, onSend,
}: {
  amount: string; fullName: string; isLoading: boolean;
  onBack: () => void; onSend: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="p-4 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)]">
        <div className="flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">Amount</span>
            <span className="text-lg font-bold text-white font-mono">{amount} USDC</span>
          </div>
          <div className="h-px bg-[rgba(255,255,255,0.06)]" />
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">To</span>
            <span className="text-sm font-semibold text-purple-400 font-mono">{fullName}</span>
          </div>
          <div className="h-px bg-[rgba(255,255,255,0.06)]" />
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">Network</span>
            <span className="text-xs text-[rgba(255,255,255,0.6)] font-mono">Arbitrum Sepolia</span>
          </div>
          <div className="h-px bg-[rgba(255,255,255,0.06)]" />
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider">Privacy</span>
            <span className="text-xs font-semibold text-purple-400 font-mono">FHE ENCRYPTED</span>
          </div>
        </div>
      </div>

      {/* Privacy note */}
      <div className="flex gap-2 items-center p-3 rounded-sm bg-[rgba(139,92,246,0.04)] border border-[rgba(139,92,246,0.12)]">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono">
          Amount encrypted with FHE — only recipient can see the value
        </span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="flex-1 py-3 rounded-sm border border-[rgba(255,255,255,0.08)] bg-transparent text-[rgba(255,255,255,0.5)] font-mono text-[11px] tracking-wider cursor-pointer hover:border-[rgba(255,255,255,0.2)] hover:text-[rgba(255,255,255,0.7)] transition-all"
        >
          BACK
        </button>
        <button
          onClick={onSend}
          disabled={isLoading}
          className={`flex-[2] py-3 rounded-sm font-mono text-[11px] tracking-wider flex items-center justify-center gap-2 transition-all ${
            isLoading
              ? "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.3)] cursor-wait"
              : "border border-purple-500/30 bg-purple-500/10 text-purple-400 cursor-pointer hover:bg-purple-500/15 hover:border-purple-400"
          }`}
        >
          {isLoading ? (
            <div className="w-3.5 h-3.5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            "ENCRYPT & SEND"
          )}
        </button>
      </div>
    </div>
  );
}

function ProgressView({ step }: { step: SendStep }) {
  const currentIdx = STEP_ORDER.indexOf(step);

  return (
    <div className="flex flex-col gap-5 py-4">
      <div className="flex flex-col items-center gap-2">
        <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-semibold text-white font-mono mt-2">
          {STEP_LABELS[step] || "Processing..."}
        </span>
      </div>

      {/* Step indicators */}
      <div className="flex flex-col gap-1.5">
        {STEP_ORDER.map((s, i) => {
          const isDone = currentIdx > i;
          const isCurrent = s === step;
          return (
            <div key={s} className="flex items-center gap-2.5">
              <div className={`w-2 h-2 rounded-full transition-colors ${
                isDone ? "bg-green-400" : isCurrent ? "bg-purple-400 animate-pulse" : "bg-[rgba(255,255,255,0.1)]"
              }`} />
              <span className={`text-[10px] font-mono transition-colors ${
                isDone ? "text-green-400/60" : isCurrent ? "text-white" : "text-[rgba(255,255,255,0.2)]"
              }`}>
                {STEP_LABELS[s]}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
        <div
          className="h-full bg-purple-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.max(5, ((currentIdx + 1) / STEP_ORDER.length) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function SuccessView({
  amount, fullName, txHash, onSendAnother,
}: {
  amount: string; fullName: string; txHash: string | null; onSendAnother: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-5 py-4">
      <div className="w-16 h-16 rounded-sm bg-[rgba(34,197,94,0.08)] border border-[rgba(34,197,94,0.2)] flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" stroke="#22c55e" strokeWidth="2.5" />
        </svg>
      </div>

      <div className="flex flex-col items-center gap-2">
        <span className="text-sm font-bold text-white font-mono tracking-wider">ENCRYPTED PAYMENT SENT</span>
        <div className="flex items-baseline gap-2">
          <span className="text-[28px] font-extrabold text-white font-mono">{amount}</span>
          <span className="text-base font-medium text-[rgba(255,255,255,0.4)]">USDC</span>
        </div>
        <span className="text-xs text-[rgba(255,255,255,0.4)] font-mono">
          sent to <span className="text-purple-400 font-semibold">{fullName}</span>
        </span>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-[rgba(255,255,255,0.3)] font-mono">Arbitrum Sepolia</span>
        </div>
      </div>

      {/* Privacy badge */}
      <div className="flex gap-2 items-center px-3 py-2 rounded-sm bg-[rgba(139,92,246,0.04)] border border-[rgba(139,92,246,0.12)]">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span className="text-[10px] text-purple-400/70 font-mono">Amount hidden via FHE</span>
      </div>

      {txHash && (
        <a
          href={`https://sepolia.arbiscan.io/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="no-underline"
        >
          <div className="flex gap-1.5 items-center px-3 py-2 rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] hover:border-[rgba(139,92,246,0.3)] transition-all cursor-pointer">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" />
            </svg>
            <span className="text-[11px] text-purple-400 font-mono font-medium">View on Explorer</span>
          </div>
        </a>
      )}

      <button
        onClick={onSendAnother}
        className="text-[10px] text-[rgba(255,255,255,0.25)] font-mono cursor-pointer bg-transparent border-none hover:text-[rgba(255,255,255,0.5)] transition-colors"
      >
        Send another payment
      </button>
    </div>
  );
}
