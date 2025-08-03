# Cross-Chain Swap Interface Setup

This project consists of a frontend Next.js application and a backend relayer service for Sepolia to Arbitrum Sepolia USDC swaps.

## Architecture

- **Frontend**: Next.js app with Web3 wallet integration
- **Backend**: Express.js relayer service that handles all cross-chain operations
- **User Actions**: Only wallet connection, token approval, and order signing
- **Relayer Actions**: Contract deployment, escrow creation, and swap execution

## Quick Start

### 1. Install Dependencies

```bash
# Install frontend dependencies
cd crosschain
npm install

# Install backend dependencies (from root directory)
cd ..
npm install express cors dotenv ethers
```

### 2. Environment Setup

Create `.env` file in root directory:
```bash
# Relayer private key (needs ETH and USDC on both chains)
RELAYER_PRIVATE_KEY=your-relayer-private-key

# RPC endpoints
SRC_CHAIN_RPC=https://eth-sepolia.g.alchemy.com/v2/your-api-key
DST_CHAIN_RPC=https://arb-sepolia.g.alchemy.com/v2/your-api-key

# Server port
PORT=3001
```

Create `crosschain/.env.local`:
```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_SEPOLIA_RPC=https://eth-sepolia.g.alchemy.com/v2/your-api-key
NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC=https://arb-sepolia.g.alchemy.com/v2/your-api-key
```

### 3. Compile Contracts

```bash
# From root directory
npm run compile
```

### 4. Start Services

```bash
# Terminal 1 - Start backend relayer
node backend-relayer.js

# Terminal 2 - Start frontend
cd crosschain
npm run dev
```

### 5. Access Application

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001/health

## User Flow

1. **Connect Wallet**: User connects MetaMask to Sepolia
2. **Deploy Contracts**: Click to deploy factory contracts (one-time)
3. **Approve USDC**: Approve spending on Sepolia
4. **Create Swap**: Enter amount and sign order
5. **Relayer Execution**: Backend handles all cross-chain operations
6. **Completion**: User receives USDC on Arbitrum Sepolia

## API Endpoints

### Backend Relayer Service

- `POST /api/deploy-factories` - Deploy escrow factory contracts
- `POST /api/create-order` - Create swap order and get signing data
- `POST /api/execute-swap` - Execute swap with user signature
- `GET /api/swap-status/:swapId` - Get swap execution status

## Token Addresses

- **Sepolia USDC**: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- **Arbitrum Sepolia USDC**: `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`

## Relayer Requirements

The relayer wallet needs:
- ETH on both Sepolia and Arbitrum Sepolia for gas
- USDC on Arbitrum Sepolia to provide liquidity
- Sufficient balance to handle swap amounts

## Security Features

- HTLC-based atomic swaps
- Time-locked contracts
- Secret revelation mechanism
- Safety deposits for incentive alignment
- All validation enabled (no bypasses)

## Troubleshooting

### Common Issues

1. **Contract deployment fails**: Check relayer has sufficient ETH
2. **Swap execution fails**: Ensure relayer has USDC on destination chain
3. **User approval fails**: Check user has sufficient USDC and ETH
4. **RPC errors**: Verify RPC endpoints are working

### Logs

Backend service provides detailed logs for debugging:
- Contract deployment status
- Swap execution steps
- Error messages with context

## Development

### File Structure

```
/
├── backend-relayer.js          # Main relayer service
├── backend-package.json        # Backend dependencies
├── crosschain/                 # Frontend application
│   ├── app/
│   │   ├── components/
│   │   │   └── SwapInterface.tsx
│   │   ├── page.tsx
│   │   └── layout.tsx
│   └── package.json
├── scripts/arb-sep.js         # Reference implementation
└── contracts/                 # Smart contracts
```

### Key Components

- **SwapInterface.tsx**: Main frontend component
- **backend-relayer.js**: Express server with swap logic
- **arb-sep.js**: Reference script for swap implementation

## Testing

1. Get testnet tokens from faucets
2. Fund relayer wallet with ETH and USDC
3. Test the complete flow on testnets
4. Monitor logs for any issues

## Next Steps

- Add support for other token pairs
- Implement fee mechanisms
- Add more robust error handling
- Deploy to production with mainnet support