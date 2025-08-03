# Environment Setup

## Frontend (.env.local)

Create a `.env.local` file in the `crosschain/` directory with the following variables:

```
# Backend API URL
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001

# RPC Endpoints (for read-only operations)
NEXT_PUBLIC_SEPOLIA_RPC=https://eth-sepolia.g.alchemy.com/v2/your-api-key
NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC=https://arb-sepolia.g.alchemy.com/v2/your-api-key
```

## Backend (.env)

Create a `.env` file in the root directory with the following variables:

```
# Private keys
PRIVATE_KEY=your-private-key-for-testing
RELAYER_PRIVATE_KEY=your-relayer-private-key

# RPC endpoints
SRC_CHAIN_RPC=https://eth-sepolia.g.alchemy.com/v2/your-api-key
DST_CHAIN_RPC=https://arb-sepolia.g.alchemy.com/v2/your-api-key

# Server port
PORT=3001
```

## Setup Instructions

1. **Get RPC endpoints from Alchemy, Infura, or similar service**
2. **Create test wallets and fund them with testnet ETH and USDC**
3. **Set up the environment files as shown above**
4. **Install dependencies and start the services**

## Getting Testnet Tokens

### Sepolia ETH
- [Alchemy Sepolia Faucet](https://sepoliafaucet.com/)
- [Chainlink Sepolia Faucet](https://faucets.chain.link/sepolia)

### Arbitrum Sepolia ETH
- [Arbitrum Sepolia Faucet](https://faucet.quicknode.com/arbitrum/sepolia)

### USDC on Sepolia
- Contract: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- Use a faucet or mint function if available

### USDC on Arbitrum Sepolia  
- Contract: `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`
- Use a faucet or mint function if available