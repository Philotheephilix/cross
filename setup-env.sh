#!/bin/bash

echo "🔧 Setting up environment variables for backend relayer..."
echo ""
echo "Please provide the following information:"
echo ""

# Get private key
echo -n "Enter your private key (the same one you used for testing): "
read -s PRIVATE_KEY
echo ""

# Get Sepolia RPC
echo -n "Enter Sepolia RPC URL (e.g., https://eth-sepolia.g.alchemy.com/v2/your-key): "
read SRC_RPC
echo ""

# Get Arbitrum Sepolia RPC  
echo -n "Enter Arbitrum Sepolia RPC URL (e.g., https://arb-sepolia.g.alchemy.com/v2/your-key): "
read DST_RPC
echo ""

# Create .env file
cat > .env << EOL
# Cross-Chain Swap Relayer Environment Variables

# Private key for the relayer wallet (needs ETH and USDC on both chains)  
RELAYER_PRIVATE_KEY=$PRIVATE_KEY

# RPC endpoints for blockchain connections
SRC_CHAIN_RPC=$SRC_RPC
DST_CHAIN_RPC=$DST_RPC

# Server configuration
PORT=3001

# Additional for compatibility with existing scripts
PRIVATE_KEY=$PRIVATE_KEY
EOL

echo "✅ .env file created successfully!"
echo ""
echo "🔍 Environment variables set:"
echo "RELAYER_PRIVATE_KEY: ${PRIVATE_KEY:0:10}..."
echo "SRC_CHAIN_RPC: $SRC_RPC"
echo "DST_CHAIN_RPC: $DST_RPC"
echo "PORT: 3001"
echo ""
echo "🚀 You can now run: node backend-relayer.js"
