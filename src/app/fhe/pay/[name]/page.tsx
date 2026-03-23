import type { Metadata } from "next";
import dynamic from "next/dynamic";

interface FHEPayPageProps {
  params: { name: string };
}

const FHEPayPageClient = dynamic(() => import("./FHEPayPageClient"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-[#06080F] flex items-center justify-center">
      <div className="text-white/40 text-sm">Loading FHE Pay...</div>
    </div>
  ),
});

export async function generateMetadata({ params }: FHEPayPageProps): Promise<Metadata> {
  const { name } = params;
  const displayName = `${name}.dust`;

  return {
    title: `Pay ${displayName} — FHE Encrypted Private Payment`,
    description: `Send an FHE-encrypted private payment to ${displayName}. Amount is hidden via fully homomorphic encryption — only the recipient can decrypt.`,
    robots: { index: false, follow: true },
  };
}

export default function FHEPayPage({ params }: FHEPayPageProps) {
  return <FHEPayPageClient name={params.name} />;
}
