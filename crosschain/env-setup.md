# Environment Setup

## Frontend (.env.local)

Create a `.env.local` file in the `crosschain/` directory with the following variables:

```
# Backend API URL
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001

# RPC Endpoints (for read-only operations)
NEXT_PUBLIC_SEPOLIA_RPC=https://eth-sepolia.g.alchemy.com/v2/your-api-key
NEXT_PUBLIC_MONAD_RPC=https://rpc.testnet.monad.xyz
```

## Backend (.env)

Create a `.env` file in the root directory with the following variables:

```
# Private keys
PRIVATE_KEY=your-private-key-for-testing
RELAYER_PRIVATE_KEY=your-relayer-private-key

# RPC endpoints
SRC_CHAIN_RPC=https://eth-sepolia.g.alchemy.com/v2/your-api-key
DST_CHAIN_RPC=https://rpc.testnet.monad.xyz

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

### Monad Testnet MON
- [Monad Testnet Faucet](https://faucet.testnet.monad.xyz/)

### WETH on Sepolia
- Contract: `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`
- Wrap ETH to get WETH using the contract's `deposit()` function

### WETH on Monad Testnet
- Contract: `0x59B993B49Cccc08c0fD418DcFfC6cA4d51F1339E`
- Wrap MON to get WETH using the contract's `deposit()` function