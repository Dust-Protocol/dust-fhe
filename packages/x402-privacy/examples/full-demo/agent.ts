/**
 * AI Agent — pays for premium API data using a ZK proof. Zero knowledge of payer identity.
 *
 * Real flow:
 *   1. Load pre-funded UTXO from setup.ts (.note.json)
 *   2. Request API → get 402 with scheme:"shielded"
 *   3. Generate FFLONK proof (~60s CPU) proving UTXO ownership
 *   4. Retry with X-PAYMENT header → server verifies on-chain → get data
 *
 * The server and facilitator see only the proof — never the deposit or the payer.
 *
 * Usage:
 *   npm run agent
 */
import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ShieldedEvmClientScheme } from "@x402/privacy/client";
import { TreeClient } from "@x402/privacy/tree";
import { computeOwnerPubKey, computeAssetId, computeNoteCommitment } from "@x402/privacy/crypto";
import type { NoteCommitmentV2 } from "@x402/privacy/crypto";
import type { ShieldedPayload } from "@x402/privacy";

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_URL = "http://localhost:3000/api/premium-data";
const TREE_SERVICE_URL = "http://localhost:3001/tree";
const NOTE_FILE = resolve(__dirname, ".note.json");

// Circuit files
const WASM_PATH = resolve(__dirname, "../../circuits/DustV2Transaction.wasm");
// zkey: try local circuits/ first, fall back to monorepo build
const ZKEY_CANDIDATES = [
  resolve(__dirname, "../../circuits/DustV2Transaction.zkey"),
  resolve(__dirname, "../../../../../../contracts/dustpool/circuits/v2/build/DustV2Transaction.zkey"),
];

interface NoteData {
  spendingKey: string;
  nullifierKey: string;
  note: {
    owner: string;
    amount: string;
    asset: string;
    chainId: number;
    blinding: string;
  };
  commitment: string;
  commitmentHex: string;
  depositTx: string;
}

function findZkey(): string {
  for (const p of ZKEY_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  console.error("ZKey not found. Run: bash ../../scripts/download-circuits.sh");
  process.exit(1);
}

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   @x402/privacy — Private API Payment Demo  ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // Load real UTXO from setup
  if (!existsSync(NOTE_FILE)) {
    console.error("No .note.json found. Run setup first: npm run setup");
    process.exit(1);
  }

  const noteData: NoteData = JSON.parse(readFileSync(NOTE_FILE, "utf-8"));
  const spendingKey = BigInt(noteData.spendingKey);
  const nullifierKey = BigInt(noteData.nullifierKey);

  console.log(`Deposit tx: ${noteData.depositTx}`);
  console.log(`Commitment: ${noteData.commitmentHex.slice(0, 20)}...`);

  // Look up the leaf index from the tree service
  console.log("\n[1/5] Looking up deposit in Merkle tree...");
  const treeClient = new TreeClient(TREE_SERVICE_URL);

  let leafIndex: number;
  try {
    const lookup = await treeClient.lookupCommitment(noteData.commitment);
    if (!lookup.exists || lookup.leafIndex === undefined) {
      console.error("Commitment not found in tree. Wait for indexer to sync and retry.");
      process.exit(1);
    }
    leafIndex = lookup.leafIndex;
    console.log(`  Found at leaf index: ${leafIndex}`);
  } catch (err) {
    console.error("Tree service unreachable. Start it first: npm run tree");
    process.exit(1);
  }

  const { root, leafCount } = await treeClient.getRoot();
  console.log(`  Tree: ${leafCount} leaves, root: ${root.toString().slice(0, 20)}...`);

  // Reconstruct the note
  const note = {
    owner: BigInt(noteData.note.owner),
    amount: BigInt(noteData.note.amount),
    asset: BigInt(noteData.note.asset),
    chainId: noteData.note.chainId,
    blinding: BigInt(noteData.note.blinding),
  };

  const utxo: NoteCommitmentV2 = {
    note,
    commitment: BigInt(noteData.commitment),
    leafIndex,
    spent: false,
  };

  // Initialize client with real keys
  const zkeyPath = findZkey();
  const client = new ShieldedEvmClientScheme({
    spendingKey,
    nullifierKey,
    treeServiceUrl: TREE_SERVICE_URL,
    wasmPath: WASM_PATH,
    zkeyPath,
  });

  client.loadUtxos([utxo]);
  const balance = Number(note.amount) / 1e6;
  console.log(`  Shielded balance: ${balance} USDC`);

  // Step 2: Request premium data
  console.log("\n[2/5] Requesting premium data...");
  const response = await fetch(API_URL);

  if (response.status !== 402) {
    console.log(`  Unexpected: ${response.status} (expected 402)`);
    return;
  }

  const paymentRequired = await response.json() as {
    accepts: Array<{
      scheme: string;
      amount: string;
      payTo: string;
      extra: { dustPoolV2: string };
    }>;
  };
  console.log("  Got 402 Payment Required");

  const shieldedOption = paymentRequired.accepts.find((a) => a.scheme === "shielded");
  if (!shieldedOption) {
    console.error("  No shielded payment option");
    return;
  }

  const price = Number(shieldedOption.amount) / 1e6;
  console.log(`  Price: ${price} USDC`);
  console.log(`  Pay to: ${shieldedOption.payTo}`);
  console.log(`  Pool: ${shieldedOption.extra.dustPoolV2}`);

  // Step 3: Generate ZK proof
  console.log("\n[3/5] Generating FFLONK zero-knowledge proof...");
  console.log("  (This proves UTXO ownership without revealing the deposit)");
  const startTime = Date.now();

  const paymentResult = await client.createPaymentPayload(2, shieldedOption as never);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const payload = paymentResult.payload as unknown as ShieldedPayload;
  const proofBytes = (payload.proof.length - 2) / 2;

  console.log(`  Proof generated in ${elapsed}s`);
  console.log(`  Proof size: ${proofBytes} bytes (FFLONK)`);
  console.log(`  Nullifier: ${payload.publicSignals.nullifier0.slice(0, 20)}...`);
  console.log(`  ChainId: ${payload.publicSignals.chainId}`);

  // Step 4: Send payment
  console.log("\n[4/5] Sending payment (X-PAYMENT header)...");
  const paymentHeader = Buffer.from(JSON.stringify(payload)).toString("base64");

  const paidResponse = await fetch(API_URL, {
    headers: { "X-PAYMENT": paymentHeader },
  });

  if (!paidResponse.ok) {
    const error = await paidResponse.json().catch(() => ({}));
    console.error(`  Payment rejected: ${paidResponse.status}`, error);
    return;
  }

  // Step 5: Receive data
  console.log("\n[5/5] Premium data received!");
  const data = await paidResponse.json();
  console.log(JSON.stringify(data, null, 2));

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   Payment complete. Server never knew who    ║");
  console.log("║   paid — only that a valid ZK proof was      ║");
  console.log("║   presented proving ownership of a UTXO      ║");
  console.log("║   in DustPoolV2.                             ║");
  console.log("╚══════════════════════════════════════════════╝");
}

main().catch((err) => {
  console.error("\nAgent failed:", err.message ?? err);
  process.exit(1);
});
