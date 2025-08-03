# cross-chain-resolver-example

## Installation

Install example deps

```shell
pnpm install
```

Install [foundry](https://book.getfoundry.sh/getting-started/installation)

```shell
curl -L https://foundry.paradigm.xyz | bash
```

Install contract deps

```shell
forge install
```

## Running

To run tests you need to provide fork urls for Ethereum and Bsc

```shell
SRC_CHAIN_RPC=ETH_FORK_URL DST_CHAIN_RPC=BNB_FORK_URL pnpm test
```

### Public rpc

| Chain    | Url                          |
|----------|------------------------------|
| Ethereum | https://eth.merkle.io        |
| BSC      | wss://bsc-rpc.publicnode.com |

## Cross-Chain Swap Script

This repository includes a standalone script for performing actual cross-chain swaps from Sepolia to Arbitrum Sepolia testnets.

### Quick Start

1. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your private key and RPC URLs
   ```

2. **Test the setup**:
   ```bash
   pnpm run test-setup
   ```

3. **Run the demo** (optional):
   ```bash
   pnpm run demo
   ```

4. **Run the simple version** (recommended for first-time users):
   ```bash
   pnpm run simple
   ```

5. **Run the cross-chain swap**:
   ```bash
   pnpm run swap
   ```

### Script Features

- ✅ **Real cross-chain swaps** from Sepolia to Arbitrum Sepolia
- ✅ **Private key from environment variables** for security
- ✅ **Automatic contract deployment** on both chains
- ✅ **USDC token swaps** with escrow-based security
- ✅ **Detailed logging** and transaction tracking
- ✅ **Balance verification** before and after swap

### Requirements

- Node.js 22+
- Foundry for contract compilation
- Sepolia ETH for gas fees
- Arbitrum Sepolia ETH for gas fees
- USDC tokens on both chains

See `scripts/README.md` for detailed documentation.

## Test accounts

### Available Accounts

```
(0) 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" Owner of EscrowFactory
(1) 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" User
(2) 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" Resolver
```
