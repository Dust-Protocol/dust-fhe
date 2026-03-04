/**
 * Tree Service — indexes DepositQueued events and serves Merkle proofs.
 *
 * Real on-chain indexing: reads Base Sepolia events, builds Poseidon Merkle tree.
 *
 * Usage:
 *   npm run tree
 */
import "dotenv/config";
import express from "express";
import { TreeIndexer } from "@x402/privacy/tree";
import { POOL_ADDRESSES } from "@x402/privacy";

const PORT = 3001;
const RPC_URL = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const POOL = POOL_ADDRESSES["eip155:84532"];

async function main(): Promise<void> {
  console.log("=== Tree Service ===");
  console.log(`Pool: ${POOL}`);
  console.log(`RPC:  ${RPC_URL}\n`);

  const indexer = new TreeIndexer({
    rpcUrl: RPC_URL,
    poolAddress: POOL,
    startBlock: 0n,
  });

  console.log("Syncing on-chain deposits...");
  await indexer.initialize();
  console.log(`Synced: ${indexer.leafCount} deposits, root: ${indexer.root.toString().slice(0, 20)}...\n`);

  const app = express();

  app.get("/tree/root", (_req, res) => {
    res.json({ root: indexer.root.toString(), leafCount: indexer.leafCount });
  });

  app.get("/tree/path/:leafIndex", async (req, res) => {
    const leafIndex = parseInt(req.params.leafIndex, 10);
    if (isNaN(leafIndex) || leafIndex < 0) {
      res.status(400).json({ error: "Invalid leaf index" });
      return;
    }
    try {
      const proof = await indexer.getProof(leafIndex);
      res.json({
        root: proof.root.toString(),
        pathElements: proof.pathElements.map(String),
        pathIndices: proof.pathIndices,
        leafIndex,
      });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  app.get("/tree/commitment/:hash", (req, res) => {
    const leafIndex = indexer.lookupCommitment(req.params.hash);
    res.json({ exists: leafIndex !== undefined, leafIndex });
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      root: indexer.root.toString(),
      leafCount: indexer.leafCount,
    });
  });

  // Poll for new deposits every 10s
  setInterval(async () => {
    try {
      const prev = indexer.leafCount;
      await indexer.sync();
      if (indexer.leafCount > prev) {
        console.log(`+${indexer.leafCount - prev} deposits (total: ${indexer.leafCount})`);
      }
    } catch (err) {
      console.error("Sync error:", (err as Error).message);
    }
  }, 10_000);

  app.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`);
    console.log(`  GET /tree/root          — Merkle root`);
    console.log(`  GET /tree/path/:index   — inclusion proof`);
    console.log(`  GET /tree/commitment/:h — lookup leaf index`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
