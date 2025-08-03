# Cross-Chain Swap Frontend

A Next.js frontend interface for Sepolia to Arbitrum Sepolia USDC swaps using a relayer service.

## Features

- 🔗 **Wallet Connection**: MetaMask integration
- 🏭 **Contract Deployment**: One-click factory deployment
- 💰 **Token Approval**: USDC approval flow
- ✍️ **Order Signing**: EIP-712 typed data signing
- 📊 **Real-time Status**: Live swap progress tracking
- 🎨 **Clean UI**: Modern, responsive design

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp env-setup.md .env.local
# Edit .env.local with your values

# Start development server
npm run dev
```

## Environment Variables

Create `.env.local`:

```
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_SEPOLIA_RPC=https://eth-sepolia.g.alchemy.com/v2/your-api-key
NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC=https://arb-sepolia.g.alchemy.com/v2/your-api-key
```

## User Journey

1. **Connect Wallet** - MetaMask connection to Sepolia
2. **Deploy Contracts** - One-time factory deployment
3. **Check Balances** - View USDC balances on both chains
4. **Enter Amount** - Specify swap amount
5. **Approve Tokens** - Approve USDC spending
6. **Sign Order** - Create and sign swap order
7. **Track Progress** - Monitor relayer execution
8. **Complete** - Receive tokens on destination chain

## Components

### SwapInterface.tsx

Main component containing:
- Wallet connection logic
- Balance loading and display
- Token approval flow
- Order creation and signing
- Status tracking and updates

## Dependencies

- **ethers.js**: Ethereum interaction
- **axios**: API communication
- **lucide-react**: Icons
- **tailwindcss**: Styling

## API Integration

Communicates with backend relayer service:

- `POST /api/deploy-factories` - Deploy contracts
- `POST /api/create-order` - Create swap order
- `POST /api/execute-swap` - Execute with signature
- `GET /api/swap-status/:id` - Track progress

## Wallet Requirements

Users need:
- MetaMask browser extension
- Sepolia testnet ETH for gas
- Sepolia USDC for swaps

## Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linting
npm run lint
```

## Network Configuration

### Sepolia (Source Chain)
- Chain ID: 11155111
- RPC: Your Sepolia RPC endpoint
- USDC: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238

### Arbitrum Sepolia (Destination Chain)
- Chain ID: 421614
- RPC: Your Arbitrum Sepolia RPC endpoint
- USDC: 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d

## Troubleshooting

### Common Issues

**Wallet not connecting**
- Ensure MetaMask is installed
- Check browser compatibility

**Network errors**
- Verify RPC endpoints in .env.local
- Check network availability

**Transaction failures**
- Ensure sufficient ETH for gas
- Verify USDC balance and allowance

**Backend connection issues**
- Confirm backend server is running
- Check NEXT_PUBLIC_BACKEND_URL

### Debug Mode

Enable console logging:
```javascript
// Add to SwapInterface.tsx
console.log('Debug info:', { account, deploymentInfo, swapStatus })
```

## Security Notes

- Only approval and signing require user interaction
- All other operations handled by relayer
- Transactions are atomic via HTLC mechanism
- No funds can be lost due to safety mechanisms

## Browser Support

- Chrome/Brave (recommended)
- Firefox
- Safari
- Edge

Requires MetaMask extension.