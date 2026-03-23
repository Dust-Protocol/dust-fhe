"use client";

import { motion } from "framer-motion";
import { RefreshCwIcon, EyeOffIcon, CheckIcon } from "lucide-react";
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
  const loading = isScanning || isLoading;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="w-full p-6 rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] backdrop-blur-sm relative overflow-hidden group"
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

      <div className="mb-6">
        <h2 className="text-3xl font-bold text-white font-mono tracking-tight mb-1 flex items-center gap-2">
          {total.toFixed(4)} <span className="flex items-center gap-1"><ETHIcon size={20} />{symbol}</span>
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-3 rounded-sm border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)]">
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
        <div className="p-3 rounded-sm border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)]">
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

      {/* USDC Balances */}
      {(usdcBalance !== undefined || encryptedUsdcBalance !== undefined) && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="p-3 rounded-sm border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)]">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
                USDC
              </span>
            </div>
            <span className="text-sm font-bold text-white font-mono">
              {usdcLoading ? "..." : usdcBalance ?? "0.00"}
            </span>
          </div>
          <div className="p-3 rounded-sm border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)]">
            <div className="flex items-center gap-1.5 mb-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
                Encrypted
              </span>
            </div>
            <span className="text-sm font-bold text-white font-mono">
              {encryptedUsdcLoading ? "..." : encryptedUsdcBalance ?? "0.00"}
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
      <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.1)] rounded-tl-sm" />
      <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.1)] rounded-tr-sm" />
      <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.1)] rounded-bl-sm" />
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.1)] rounded-br-sm" />
    </motion.div>
  );
}
