#!/usr/bin/env bash
# Foundry Installation & Deployment Script
# Run this to install Foundry and deploy NoctFinance contracts

set -e  # Exit on error

echo "=========================================="
echo "NoctFinance Deployment Setup"
echo "=========================================="
echo ""

# Step 1: Install Foundry
echo "Step 1: Installing Foundry..."
echo ""
if command -v forge &> /dev/null; then
    echo "✅ Foundry already installed: $(forge --version)"
else
    echo "Installing Foundry..."
    curl -L https://foundry.paradigm.xyz | bash

    # Source the environment to get foundryup in PATH
    if [ -f "$HOME/.bashrc" ]; then
        source "$HOME/.bashrc"
    fi

    # Run foundryup to install forge, cast, anvil, chisel
    foundryup

    echo "✅ Foundry installed successfully!"
fi

echo ""
echo "Step 2: Verifying Foundry installation..."
forge --version
cast --version

echo ""
echo "=========================================="
echo "Foundry is ready!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Set your deployer private key:"
echo "   export DEPLOYER_PRIVATE_KEY=0x<your-private-key>"
echo ""
echo "2. Navigate to contracts directory:"
echo "   cd code/contracts"
echo ""
echo "3. Run deployment:"
echo "   forge script script/DeployHorizenTestnet.s.sol:DeployHorizenTestnet \\"
echo "     --rpc-url https://gobi-rpc.horizenlabs.io/ethv1 \\"
echo "     --broadcast \\"
echo "     --slow \\"
echo "     --legacy"
echo ""
