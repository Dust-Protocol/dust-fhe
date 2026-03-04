/**
 * Setup — Deposit USDC into DustPoolV2 on Base Sepolia.
 *
 * This creates a real on-chain UTXO that the AI agent will spend later.
 * Run once before the demo. The note data is saved to .note.json for the agent.
 *
 * Usage:
 *   npm run setup
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { writeFileSync, existsSync } from "fs";
import {
  computeOwnerPubKey,
  computeAssetId,
  computeNoteCommitment,
  generateBlinding,
} from "@x402/privacy/crypto";
import { POOL_ADDRESSES, DUST_POOL_V2_ABI } from "@x402/privacy";

const CHAIN_ID = 84532;
const NETWORK = "eip155:84532";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const DEPOSIT_AMOUNT = parseUnits("0.50", 6); // 0.50 USDC
const POOL = POOL_ADDRESSES[NETWORK];
const NOTE_FILE = ".note.json";

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

async function main(): Promise<void> {
  const key = process.env.PRIVATE_KEY as `0x${string}`;
  if (!key) {
    console.error("Missing PRIVATE_KEY in .env");
    process.exit(1);
  }

  if (existsSync(NOTE_FILE)) {
    console.log(`Note file ${NOTE_FILE} already exists. Delete it to re-deposit.`);
    process.exit(0);
  }

  const rpc = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });

  console.log("=== @x402/privacy Demo Setup ===\n");
  console.log(`Wallet:  ${account.address}`);
  console.log(`Pool:    ${POOL}`);
  console.log(`Deposit: ${formatUnits(DEPOSIT_AMOUNT, 6)} USDC\n`);

  // Check USDC balance
  const balance = (await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  console.log(`USDC balance: ${formatUnits(balance, 6)}`);
  if (balance < DEPOSIT_AMOUNT) {
    console.error(`\nInsufficient USDC. Need ${formatUnits(DEPOSIT_AMOUNT, 6)}, have ${formatUnits(balance, 6)}`);
    console.error("Get test USDC at: https://faucet.circle.com (select Base Sepolia)");
    process.exit(1);
  }

  // Derive ZK keys from the private key
  // In production: deriveV2Keys(walletSignature, PIN). For demo: deterministic from privkey.
  const spendingKey = BigInt(key) % 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const nullifierKey = (spendingKey * 7n + 3n) % 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

  // Create note commitment
  const owner = await computeOwnerPubKey(spendingKey);
  const asset = await computeAssetId(CHAIN_ID, USDC_ADDRESS);
  const blinding = generateBlinding();

  const note = { owner, amount: DEPOSIT_AMOUNT, asset, chainId: CHAIN_ID, blinding };
  const commitment = await computeNoteCommitment(note);
  const commitmentHex = ("0x" + commitment.toString(16).padStart(64, "0")) as `0x${string}`;

  console.log(`\nCommitment: ${commitmentHex.slice(0, 20)}...`);

  // Step 1: Approve USDC
  console.log("\n[1/2] Approving USDC...");
  const approveTx = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [POOL, DEPOSIT_AMOUNT],
  });
  const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
  if (approveReceipt.status !== "success") {
    console.error("Approve tx reverted:", approveTx);
    process.exit(1);
  }
  console.log(`  Approved: ${approveTx}`);

  // Step 2: Deposit into DustPoolV2
  console.log("[2/2] Depositing into DustPoolV2...");
  const depositTx = await walletClient.writeContract({
    address: POOL,
    abi: DUST_POOL_V2_ABI,
    functionName: "depositERC20",
    args: [commitmentHex, USDC_ADDRESS, DEPOSIT_AMOUNT],
  });
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
  if (depositReceipt.status !== "success") {
    console.error("Deposit tx reverted:", depositTx);
    process.exit(1);
  }
  console.log(`  Deposited: ${depositTx}`);

  // Save note for the agent
  const noteData = {
    spendingKey: spendingKey.toString(),
    nullifierKey: nullifierKey.toString(),
    note: {
      owner: owner.toString(),
      amount: DEPOSIT_AMOUNT.toString(),
      asset: asset.toString(),
      chainId: CHAIN_ID,
      blinding: blinding.toString(),
    },
    commitment: commitment.toString(),
    commitmentHex,
    depositTx,
    network: NETWORK,
    timestamp: Date.now(),
  };

  writeFileSync(NOTE_FILE, JSON.stringify(noteData, null, 2));
  console.log(`\nNote saved to ${NOTE_FILE}`);
  console.log("\nSetup complete! Wait ~15s for the tree service to index, then run the demo.");
  console.log("  npm run demo");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
