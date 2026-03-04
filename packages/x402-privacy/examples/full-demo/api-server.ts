/**
 * API Server — premium data behind a shielded 402 paywall.
 *
 * Real flow:
 *   1. GET /api/premium-data (no payment) → 402 with scheme:"shielded"
 *   2. GET /api/premium-data (with X-PAYMENT) → validates via facilitator → premium data
 *
 * The server NEVER sees the payer's identity — only the ZK proof.
 *
 * Usage:
 *   npm run server
 */
import "dotenv/config";
import express from "express";
import {
  SCHEME_NAME,
  POOL_ADDRESSES,
  DEFAULT_ASSETS,
  TREE_DEPTH,
} from "@x402/privacy";

const app = express();
const PORT = 3000;
const NETWORK = "eip155:84532";
const FACILITATOR_URL = "http://localhost:3002";
const TREE_SERVICE_URL = "http://localhost:3001/tree";

// The API provider's wallet — receives payment
const PAY_TO = process.env.PAY_TO ?? process.env.PRIVATE_KEY
  ? undefined // will be set from private key below
  : "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0";

let payToAddress = PAY_TO;

// Derive payTo from PRIVATE_KEY if available
if (!payToAddress && process.env.PRIVATE_KEY) {
  import("viem/accounts").then(({ privateKeyToAccount }) => {
    const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
    payToAddress = account.address;
    console.log(`Pay-to address: ${payToAddress}`);
  });
}

// 0.10 USDC (6 decimals)
const PRICE = "100000";

interface ParsedPayment {
  proof: string;
  publicSignals: Record<string, string>;
}

app.use((req, _res, next) => {
  const raw = req.headers["x-payment"];
  if (raw && typeof raw === "string") {
    try {
      const decoded = Buffer.from(raw, "base64").toString();
      (req as express.Request & { payment?: ParsedPayment }).payment = JSON.parse(decoded);
    } catch {
      // malformed — treat as no payment
    }
  }
  next();
});

app.get("/api/premium-data", async (req, res) => {
  const payment = (req as express.Request & { payment?: ParsedPayment }).payment;

  if (!payment) {
    res.status(402).json({
      x402Version: 2,
      error: "Payment required",
      resource: {
        url: "/api/premium-data",
        description: "Premium AI training dataset — tokenized Llama-3 corpus",
      },
      accepts: [
        {
          scheme: SCHEME_NAME,
          network: NETWORK,
          amount: PRICE,
          asset: DEFAULT_ASSETS[NETWORK].address,
          payTo: payToAddress ?? "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
          maxTimeoutSeconds: 300,
          extra: {
            dustPoolV2: POOL_ADDRESSES[NETWORK],
            merkleRoot: "0",
            treeDepth: TREE_DEPTH,
            treeServiceUrl: TREE_SERVICE_URL,
            supportedAssets: [DEFAULT_ASSETS[NETWORK].address],
          },
        },
      ],
    });
    return;
  }

  // Real validation: forward proof to facilitator
  console.log("Payment received — verifying with facilitator...");
  try {
    const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proof: payment.proof,
        publicSignals: payment.publicSignals,
        amount: PRICE,
        network: NETWORK,
        payTo: payToAddress ?? "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      }),
    });
    const result = await verifyRes.json() as { isValid: boolean; invalidReason?: string };

    if (!result.isValid) {
      console.log(`Payment REJECTED: ${result.invalidReason}`);
      res.status(402).json({
        error: "Invalid payment proof",
        reason: result.invalidReason,
      });
      return;
    }
  } catch (err) {
    console.error("Facilitator unreachable:", (err as Error).message);
    res.status(503).json({ error: "Payment verification unavailable" });
    return;
  }

  // Settle: instruct facilitator to call DustPoolV2.withdraw()
  console.log("Proof valid — settling on-chain...");
  try {
    const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proof: payment.proof,
        publicSignals: payment.publicSignals,
        payTo: payToAddress ?? "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
        asset: DEFAULT_ASSETS[NETWORK].address,
        network: NETWORK,
      }),
    });
    const settleResult = await settleRes.json() as { success: boolean; transaction?: string };

    if (settleResult.success) {
      console.log(`Settled! tx: ${settleResult.transaction}`);
    } else {
      console.log("Settlement failed — serving data anyway (proof was valid)");
    }
  } catch (err) {
    console.error("Settlement error:", (err as Error).message);
  }

  // Serve premium data
  res.json({
    data: "Premium AI training dataset: Llama-3-tokenized corpus v4.2",
    records: 1_500_000,
    format: "parquet",
    size: "2.3 GB",
    checksum: "sha256:a1b2c3d4e5f6...",
    downloadUrl: "https://data.dustprotocol.xyz/datasets/llama3-v4.2.parquet",
    paidWith: "x402/shielded",
    timestamp: Date.now(),
  });
});

app.listen(PORT, () => {
  console.log(`\n=== API Server ===`);
  console.log(`Premium data: http://localhost:${PORT}/api/premium-data`);
  console.log(`Price: 0.10 USDC (shielded, Base Sepolia)`);
  console.log(`Pool:  ${POOL_ADDRESSES[NETWORK]}`);
});
