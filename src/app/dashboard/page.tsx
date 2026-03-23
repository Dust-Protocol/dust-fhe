import { docsMetadata } from "@/lib/seo/metadata";
import DashboardPageClient from "./DashboardPageClient";

export const metadata = docsMetadata(
  "Private Dashboard — FHE Stealth Payments",
  "Send and receive private payments with fully homomorphic encryption. Balances encrypted on-chain, decrypted only client-side.",
  "/dashboard",
);

export default function DashboardPage() {
  return <DashboardPageClient />;
}
