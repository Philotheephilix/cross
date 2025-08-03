# Cross-Chain Swap Scripts

This directory contains scripts for performing actual cross-chain swaps using the 1inch cross-chain resolver.

## Cross-Chain Swap Script

The `cross-chain-swap.ts` script performs an actual cross-chain swap from Sepolia to Arbitrum Sepolia testnets.

### Prerequisites

1. **Environment Variables**: Create a `.env` file in the root directory with the following variables:

```bash
# Your private key (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# RPC URLs for the chains
SRC_CHAIN_RPC=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
DST_CHAIN_RPC=https://sepolia.arbitrum.io/rpc

# Optional: Set to true to create forks instead of using live networks
SRC_CHAIN_CREATE_FORK=false
DST_CHAIN_CREATE_FORK=false
```

2. **Funded Accounts**: Ensure your wallet has:
   - Sepolia ETH for gas fees
   - Arbitrum Sepolia ETH for gas fees
   - USDC tokens on both chains (the script will attempt to fund the resolver if needed)

### Testing Setup

Before running the main swap script, you can test that everything is configured correctly:

```bash
# Test the setup
pnpm run test-setup
```

### Demo Script

To see how the cross-chain swap works without actually deploying contracts:

```bash
# Run the demo
pnpm run demo
```

This will show you the complete flow including:
- Order creation with secret and hashlock
- Escrow immutables generation
- Address calculation
- Step-by-step swap process

### Simple Script

To get a comprehensive overview with RPC endpoint analysis and gas requirements:

```bash
# Run the simple version
pnpm run simple
```

This script provides:
- RPC endpoint validation and recommendations
- Complete swap flow demonstration
- Gas requirement estimates
- Troubleshooting guidance for public RPC endpoints

### Running the Script

```bash
# Build the contracts first
forge build

# Run the cross-chain swap
pnpm run swap
```

Or run directly with Node:

```bash
# Build the contracts first
forge build

# Run the script
node --experimental-vm-modules scripts/cross-chain-swap.js
```

### What the Script Does

1. **Setup**: Deploys EscrowFactory and Resolver contracts on both chains
2. **Funding**: Ensures the resolver has sufficient USDC on the destination chain
3. **Order Creation**: Creates a cross-chain order with a secret hashlock
4. **Source Escrow**: Deploys and funds the source escrow with USDC
5. **Destination Escrow**: Deploys and fills the destination escrow
6. **Secret Revelation**: Reveals the secret on the source chain to complete the swap
7. **Verification**: Checks final balances and provides a summary

### Expected Output

The script will output detailed logs showing:
- Initial balances
- Contract deployments
- Transaction confirmations
- Final balances
- Swap summary with addresses and amounts

### Troubleshooting

- **Insufficient Funds**: Make sure your wallet has enough ETH for gas fees and USDC for the swap
- **RPC Issues**: Verify your RPC URLs are correct and accessible
- **Contract Deployment**: The script will deploy contracts if they don't exist. This may take some time and require gas fees.

### Security Notes

- Never commit your private key to version control
- Use testnet private keys only
- The script uses a 0.1 USDC swap amount by default - modify the `swapAmount` variable if needed 