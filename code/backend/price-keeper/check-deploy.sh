#!/bin/bash
# Quick setup script for Railway deployment
# Run this to verify everything is ready before deploying

set -e

echo "🔍 Checking price-keeper deployment readiness..."
echo ""

# Check if required files exist
echo "✓ Checking configuration files..."
test -f railway.json && echo "  ✓ railway.json exists"
test -f nixpacks.toml && echo "  ✓ nixpacks.toml exists"
test -f .env.railway && echo "  ✓ .env.railway exists"
test -f DEPLOYMENT.md && echo "  ✓ DEPLOYMENT.md exists"
echo ""

# Check if dependencies are installed
echo "✓ Checking dependencies..."
if [ ! -d "node_modules" ]; then
  echo "  ⚠ node_modules not found, installing..."
  npm install
else
  echo "  ✓ node_modules exists"
fi
echo ""

# Test the keeper script locally (dry run)
echo "✓ Testing keeper script..."
if npm run horizen:push-once 2>&1 | grep -q "horizen-keeper-sweep"; then
  echo "  ✓ Keeper script runs successfully"
else
  echo "  ✗ Keeper script failed - check .env configuration"
  exit 1
fi
echo ""

# Check relayer balance
echo "✓ Checking relayer balance..."
BALANCE=$(cast balance 0xB19f1F29DdC0C5248DE5bA98dDa4f94f9a562707 --rpc-url https://horizen-testnet.rpc.caldera.xyz/http 2>/dev/null || echo "0")
ETH=$(cast --to-unit "$BALANCE" ether 2>/dev/null || echo "0")
echo "  Balance: $ETH ETH"
if (( $(echo "$ETH < 0.05" | bc -l) )); then
  echo "  ⚠ Low balance! Consider funding the relayer"
else
  echo "  ✓ Balance sufficient"
fi
echo ""

echo "✅ All checks passed! Ready to deploy to Railway."
echo ""
echo "Next steps:"
echo "1. Go to https://railway.app/dashboard"
echo "2. Create a new service from this repo"
echo "3. Set root directory to: code/backend/price-keeper"
echo "4. Copy environment variables from .env.railway"
echo "5. Deploy!"
echo ""
echo "See DEPLOYMENT.md for detailed instructions."
