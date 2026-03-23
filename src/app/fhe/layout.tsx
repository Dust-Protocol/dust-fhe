"use client";

import dynamic from "next/dynamic";
import { Navbar } from "@/components/layout/Navbar";

const FHEProviderWrapper = dynamic(() => import("./FHEProviderWrapper"), {
  ssr: false,
});

export default function FHELayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#06080F] text-white">
      <Navbar />
      <main className="pt-14">
        <FHEProviderWrapper>{children}</FHEProviderWrapper>
      </main>
    </div>
  );
}
