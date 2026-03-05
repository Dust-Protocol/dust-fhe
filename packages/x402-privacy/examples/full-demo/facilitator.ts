/**
 * Facilitator — verifies ZK proofs on-chain and settles payments.
 *
 * Real flow:
 *   1. POST /verify  — calls FFLONK verifier + DustPoolV2 (isKnownRoot, nullifiers)
 *   2. POST /settle  — calls DustPoolV2.withdraw() to transfer funds to recipient
 *
 * Usage:
 *   npm run facilitator
 */
import "dotenv/config";
import express from "express";
import { createPublicClient, createWalletClient, http, encodeFunctionData } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ShieldedEvmFacilitatorScheme } from "@x402/privacy/facilitator";
import type { FacilitatorEvmSigner } from "@x402/privacy/facilitator";
import {
  POOL_ADDRESSES,
  DEFAULT_ASSETS,
  DUST_POOL_V2_ABI,
  BN254_FIELD_SIZE,
} from "@x402/privacy";
import type { ShieldedPayload } from "@x402/privacy";

const app = express();
app.use(express.json({ limit: "5mb" }));
const PORT = 3002;
const NETWORK = "eip155:84532";

const rpc = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const key = process.env.PRIVATE_KEY as `0x${string}` | undefined;

if (!key) {
  console.error("Missing PRIVATE_KEY in .env — settlement will fail");
}

const account = key ? privateKeyToAccount(key) : undefined;
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const walletClient = account
  ? createWalletClient({ account, chain: baseSepolia, transport: http(rpc) })
  : undefined;

function buildSigner(): FacilitatorEvmSigner {
  return {
    getAddresses: () => (account ? [account.address] : []),
    readContract: (args) =>
      publicClient.readContract({
        address: args.address,
        abi: args.abi as readonly Record<string, unknown>[],
        functionName: args.functionName,
        args: args.args as readonly unknown[],
      }),
    writeContract: async (args) => {
      if (!walletClient) throw new Error("No PRIVATE_KEY");
      return walletClient.writeContract({
        address: args.address,
        abi: args.abi as readonly Record<string, unknown>[],
        functionName: args.functionName,
        args: args.args as readonly unknown[],
      });
    },
    waitForTransactionReceipt: async (args) => {
      const r = await publicClient.waitForTransactionReceipt({ hash: args.hash });
      return { status: r.status };
    },
    verifyTypedData: async () => false,
    sendTransaction: async () => { throw new Error("Not needed"); },
    getCode: (args) => publicClient.getCode({ address: args.address }),
  };
}

const facilitator = new ShieldedEvmFacilitatorScheme(buildSigner(), {
  poolAddresses: POOL_ADDRESSES,
  supportedAssets: { [NETWORK]: [DEFAULT_ASSETS[NETWORK].address] },
});

// Verify — real on-chain FFLONK proof verification
app.post("/verify", async (req, res) => {
  const { proof, publicSignals, amount, network, payTo } = req.body;
  if (!publicSignals) {
    res.status(400).json({ isValid: false, invalidReason: "missing_signals" });
    return;
  }

  try {
    const result = await facilitator.verify(
      { x402Version: 2, resource: { url: "", description: "", mimeType: "" }, accepted: {}, payload: { proof, publicSignals } } as unknown as PaymentPayload,
      {
        scheme: "shielded",
        amount: amount ?? "100000",
        network: network ?? NETWORK,
        payTo: payTo ?? account?.address ?? "0x0",
        asset: DEFAULT_ASSETS[NETWORK].address,
        maxTimeoutSeconds: 300,
        extra: {},
      },
    );
    console.log(`Verify: ${result.isValid ? "VALID" : `INVALID (${result.invalidReason})`}`);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      isValid: false,
      invalidReason: "verify_error",
      invalidMessage: (err as Error).message,
    });
  }
});

// Settle — real on-chain DustPoolV2.withdraw()
// Direct contract call (this demo wallet is the pool relayer)
app.post("/settle", async (req, res) => {
  if (!walletClient || !account) {
    res.status(500).json({ success: false, errorReason: "no_private_key" });
    return;
  }

  const { proof, publicSignals, payTo, asset } = req.body;
  const shielded: ShieldedPayload = { proof, publicSignals };

  const toBytesHex = (v: string): `0x${string}` =>
    ("0x" + BigInt(v).toString(16).padStart(64, "0")) as `0x${string}`;

  try {
    const pool = POOL_ADDRESSES[NETWORK];
    const txHash = await walletClient.writeContract({
      address: pool,
      abi: DUST_POOL_V2_ABI,
      functionName: "withdraw",
      args: [
        shielded.proof,
        toBytesHex(shielded.publicSignals.merkleRoot),
        toBytesHex(shielded.publicSignals.nullifier0),
        toBytesHex(shielded.publicSignals.nullifier1),
        toBytesHex(shielded.publicSignals.outputCommitment0),
        toBytesHex(shielded.publicSignals.outputCommitment1),
        BigInt(shielded.publicSignals.publicAmount),
        BigInt(shielded.publicSignals.publicAsset),
        (payTo ?? account.address) as `0x${string}`,
        (asset ?? DEFAULT_ASSETS[NETWORK].address) as `0x${string}`,
      ],
    });

    console.log(`Settle: tx ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    res.json({
      success: receipt.status === "success",
      transaction: txHash,
      network: NETWORK,
    });
  } catch (err) {
    console.error("Settle error:", (err as Error).message);
    res.status(500).json({
      success: false,
      errorReason: "settle_failed",
      errorMessage: (err as Error).message,
      transaction: "",
      network: NETWORK,
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    network: NETWORK,
    pool: POOL_ADDRESSES[NETWORK],
    signer: account?.address ?? "none",
  });
});

app.listen(PORT, () => {
  console.log(`\n=== Facilitator ===`);
  console.log(`Verify: POST http://localhost:${PORT}/verify`);
  console.log(`Settle: POST http://localhost:${PORT}/settle`);
  console.log(`Signer: ${account?.address ?? "NOT SET"}`);
  console.log(`Pool:   ${POOL_ADDRESSES[NETWORK]}`);
});
