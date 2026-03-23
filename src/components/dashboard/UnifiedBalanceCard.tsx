"use client";

import { motion } from "framer-motion";
import { RefreshCwIcon, EyeOffIcon, CheckIcon, LockIcon } from "lucide-react";
import { getChainConfig } from "@/config/chains";
import { useAuth } from "@/contexts/AuthContext";
import { ETHIcon } from "@/components/stealth/icons";

interface UnifiedBalanceCardProps {
  total: number;
  stealthTotal: number;
  claimTotal: number;
  unclaimedCount: number;
  isScanning: boolean;
  isLoading: boolean;
  onRefresh: () => void;
  usdcBalance?: string | null;
  usdcLoading?: boolean;
  encryptedUsdcBalance?: string | null;
  encryptedUsdcLoading?: boolean;
}

function formatUsdcDisplay(raw: string | null | undefined): string {
  if (!raw) return "0.00";
  const num = parseFloat(raw);
  if (isNaN(num)) return "0.00";
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function UnifiedBalanceCard({
  total,
  stealthTotal,
  claimTotal,
  unclaimedCount,
  isScanning,
  isLoading,
  onRefresh,
  usdcBalance,
  usdcLoading,
  encryptedUsdcBalance,
  encryptedUsdcLoading,
}: UnifiedBalanceCardProps) {
  const { activeChainId } = useAuth();
  const chainConfig = getChainConfig(activeChainId);
  const symbol = chainConfig.nativeCurrency.symbol;
  const loading = isScanning || isLoading || usdcLoading;

  const usdcDisplay = formatUsdcDisplay(usdcBalance);
  const encDisplay = formatUsdcDisplay(encryptedUsdcBalance);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="w-full p-6 rounded-sm border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] backdrop-blur-sm relative overflow-hidden group"
    >
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-1.5 h-1.5 rounded-full bg-[#00FF41] shadow-[0_0_4px_#00FF41]"
          />
          <span className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
            BALANCE_OVERVIEW
          </span>
        </div>
        <button
          onClick={onRefresh}
          className="text-[rgba(255,255,255,0.4)] hover:text-[#00FF41] transition-colors"
        >
          <RefreshCwIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Primary: USDC balance */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-white font-mono tracking-tight mb-1 flex items-center gap-2">
          {usdcLoading ? "..." : usdcDisplay} <span className="text-base text-[rgba(255,255,255,0.4)] font-medium">USDC</span>
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Available USDC (plain) */}
        <div className="p-3 rounded-sm border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)]">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckIcon className="w-3 h-3 text-[rgba(255,255,255,0.4)]" />
            <span className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
              Available
            </span>
          </div>
          <span className="text-sm font-bold text-white font-mono">
            {usdcLoading ? "..." : usdcDisplay} USDC
          </span>
        </div>
        {/* Encrypted USDC (in ConfidentialToken) */}
        <div className="p-3 rounded-sm border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)]">
          <div className="flex items-center gap-1.5 mb-1">
            <LockIcon className="w-3 h-3 text-[rgba(255,255,255,0.4)]" />
            <span className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
              Encrypted
            </span>
          </div>
          <span className="text-sm font-bold text-white font-mono">
            {encryptedUsdcLoading ? "..." : encDisplay} USDC
          </span>
        </div>
      </div>

      {/* Secondary: ETH stealth balances */}
      {(stealthTotal > 0 || claimTotal > 0) && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="p-3 rounded-sm border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)]">
            <div className="flex items-center gap-1.5 mb-1">
              <EyeOffIcon className="w-3 h-3 text-[rgba(255,255,255,0.4)]" />
              <span className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
                Stealth
              </span>
            </div>
            <span className="text-sm font-bold text-white font-mono flex items-center gap-1">
              {stealthTotal.toFixed(4)} <ETHIcon size={14} /> {symbol}
            </span>
          </div>
          <div className="p-3 rounded-sm border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)]">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckIcon className="w-3 h-3 text-[rgba(255,255,255,0.4)]" />
              <span className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
                Claimed
              </span>
            </div>
            <span className="text-sm font-bold text-white font-mono flex items-center gap-1">
              {claimTotal.toFixed(4)} <ETHIcon size={14} /> {symbol}
            </span>
          </div>
        </div>
      )}

      {unclaimedCount > 0 && (
        <div className="flex justify-center">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[rgba(255,176,0,0.1)] border border-[rgba(255,176,0,0.2)]">
            <div className="w-1.5 h-1.5 rounded-full bg-[#FFB000] animate-pulse" />
            <span className="text-[9px] text-[#FFB000] font-mono tracking-wide">
              {unclaimedCount} unclaimed payment{unclaimedCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}

      {/* Corner accents */}
      <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.15)] rounded-tl-sm" />
      <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.15)] rounded-tr-sm" />
      <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.15)] rounded-bl-sm" />
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.15)] rounded-br-sm" />
    </motion.div>
  );
}
