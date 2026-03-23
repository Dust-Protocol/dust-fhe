"use client";

export function ComingSoonOverlay({ message }: { message?: string }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center backdrop-blur-[2px] bg-[rgba(6,8,15,0.35)]">
      <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(6,8,15,0.7)]">
        <p className="text-[22px] font-bold font-mono tracking-widest text-white">COMING SOON</p>
        <p className="text-[13px] text-[rgba(255,255,255,0.4)] font-mono text-center max-w-[280px]">
          {message ?? "This feature is under development and will be available shortly."}
        </p>
      </div>
    </div>
  );
}
