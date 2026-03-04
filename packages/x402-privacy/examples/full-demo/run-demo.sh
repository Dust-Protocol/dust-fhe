#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
PIDS=()

cleanup() {
  echo ""
  echo "Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

# Check .env
if [ ! -f .env ]; then
  echo "Missing .env file. Copy .env.example and fill in PRIVATE_KEY:"
  echo "  cp .env.example .env"
  exit 1
fi

# Check .note.json (from setup.ts)
if [ ! -f .note.json ]; then
  echo "No .note.json found. Run setup first to deposit USDC:"
  echo "  npm run setup"
  exit 1
fi

# Check zkey
ZKEY_PATH="$SCRIPT_DIR/../../circuits/DustV2Transaction.zkey"
ZKEY_ALT="$SCRIPT_DIR/../../../../../../contracts/dustpool/circuits/v2/build/DustV2Transaction.zkey"
if [ ! -f "$ZKEY_PATH" ] && [ ! -f "$ZKEY_ALT" ]; then
  echo "ZKey not found. Download it first:"
  echo "  bash ../../scripts/download-circuits.sh"
  exit 1
fi

echo "╔══════════════════════════════════════════════╗"
echo "║   @x402/privacy — Full E2E Demo             ║"
echo "║                                              ║"
echo "║   All components are REAL:                   ║"
echo "║   • Real USDC deposit on Base Sepolia        ║"
echo "║   • Real Merkle tree from on-chain events    ║"
echo "║   • Real FFLONK proof generation (~60s)      ║"
echo "║   • Real on-chain proof verification         ║"
echo "║   • Real DustPoolV2.withdraw() settlement    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

echo "[1/4] Starting tree service (port 3001)..."
npx tsx tree-service.ts &
PIDS+=($!)

echo "[2/4] Starting facilitator (port 3002)..."
npx tsx facilitator.ts &
PIDS+=($!)

echo "[3/4] Starting API server (port 3000)..."
npx tsx api-server.ts &
PIDS+=($!)

echo ""
echo "Waiting for services..."
sleep 5

# Health-check tree service
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 10 ]; then
    echo "Tree service did not start. Check RPC connection."
    exit 1
  fi
  sleep 2
done

# Health-check facilitator
for i in 1 2 3; do
  if curl -sf http://localhost:3002/health > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo ""
echo "[4/4] Running AI agent..."
echo ""

npx tsx agent.ts

echo ""
echo "Demo complete."
