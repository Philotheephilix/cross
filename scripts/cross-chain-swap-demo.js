#!/usr/bin/env node

import 'dotenv/config'
import { ethers } from 'ethers'
import { CustomSDK as Sdk } from '../tests/custom-sdk.js'
import { config } from '../tests/config.js'
import { uint8ArrayToHex, randomBytes, UINT_40_MAX } from '../tests/utils.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const factoryContract = JSON.parse(readFileSync(join(__dirname, '../dist/contracts/TestEscrowFactory.sol/TestEscrowFactory.json'), 'utf8'))
const resolverContractArtifact = JSON.parse(readFileSync(join(__dirname, '../dist/contracts/Resolver.sol/Resolver.json'), 'utf8'))

// ERC20 ABI for token interactions
const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
]

// Escrow ABI for real escrow interactions
const ESCROW_ABI = [
    'function fill(bytes calldata order, bytes calldata signature, bytes calldata interaction) external payable returns (uint256)',
    'function cancel() external',
    'function withdraw() external',
    'function publicWithdraw() external',
    'function publicCancel() external',
    'function getEscrowInfo() external view returns (tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks))'
]

async function main() {
    console.log('🚀 Cross-Chain Swap Demo: Sepolia → Arbitrum Sepolia')
    console.log('='.repeat(60))

    // Validate environment variables
    const privateKey = process.env.PRIVATE_KEY
    if (!privateKey) {
        throw new Error('PRIVATE_KEY environment variable is required')
    }

    if (!process.env.SRC_CHAIN_RPC || !process.env.DST_CHAIN_RPC) {
        throw new Error('SRC_CHAIN_RPC and DST_CHAIN_RPC environment variables are required')
    }

    console.log('✅ Environment variables validated')

    // Demo the cross-chain swap process
    await demonstrateCrossChainSwap(privateKey)
}

async function demonstrateCrossChainSwap(privateKey) {
    console.log('\n🎭 Cross-Chain Swap Demonstration')
    console.log('='.repeat(40))

    // Create demo wallet
    const wallet = new ethers.Wallet(privateKey)
    console.log(`   Demo wallet address: ${wallet.address}`)

    // Demo swap parameters
    const swapAmount = ethers.parseUnits('0.1', 6) // 0.1 USDC
    const safetyDeposit = ethers.parseEther('0.001') // 0.001 ETH

    console.log('\n📊 Demo Swap Parameters:')
    console.log(`   Swap amount: ${ethers.formatUnits(swapAmount, 6)} USDC`)
    console.log(`   Safety deposit: ${ethers.formatEther(safetyDeposit)} ETH`)

    // Step 1: Demo order creation
    console.log('\n📝 Step 1: Creating cross-chain order...')
    const secret = uint8ArrayToHex(randomBytes(32))
    const hashlock = Sdk.HashLock.forSingleFill(secret)
    
    const order = Sdk.CrossChainOrder.new(
        '0x1234567890123456789012345678901234567890', // demo factory address
        {
            salt: Sdk.randBigInt(1000n),
            nonce: Sdk.randBigInt(UINT_40_MAX),
            maker: wallet.address,
            makingAmount: swapAmount,
            takingAmount: swapAmount, // 1:1 swap for simplicity
            makerAsset: config.chain.source.tokens.USDC.address,
            takerAsset: config.chain.destination.tokens.USDC.address
        },
        {
            allowPartialFills: false,
            allowMultipleFills: false
        }
    )

    const orderHash = order.getOrderHash(config.chain.source.chainId)
    console.log(`   ✅ Order created with hash: ${orderHash}`)
    console.log(`   ✅ Secret generated: ${secret.substring(0, 10)}...`)
    console.log(`   ✅ Hashlock created: ${hashlock.substring(0, 10)}...`)

    // Step 2: Demo source escrow immutables
    console.log('\n🏗️ Step 2: Creating source escrow immutables...')
    const srcImmutables = order.toSrcImmutables(
        config.chain.source.chainId,
        wallet.address, // taker
        swapAmount,
        hashlock
    )
    console.log(`   ✅ Source escrow immutables created`)
    console.log(`   - Order hash: ${srcImmutables.orderHash.substring(0, 10)}...`)
    console.log(`   - Hashlock: ${srcImmutables.hashlock.substring(0, 10)}...`)
    console.log(`   - Maker: ${srcImmutables.maker}`)
    console.log(`   - Taker: ${srcImmutables.taker}`)
    console.log(`   - Token: ${srcImmutables.token}`)
    console.log(`   - Amount: ${ethers.formatUnits(srcImmutables.amount, 6)} USDC`)

    // Step 3: Demo destination escrow immutables
    console.log('\n🏗️ Step 3: Creating destination escrow immutables...')
    const dstImmutables = {
        ...srcImmutables,
        taker: wallet.address,
        amount: swapAmount,
        token: config.chain.destination.tokens.USDC.address,
        safetyDeposit: safetyDeposit,
        timelocks: srcImmutables.timelocks
    }
    console.log(`   ✅ Destination escrow immutables created`)
    console.log(`   - Token: ${dstImmutables.token}`)
    console.log(`   - Safety deposit: ${ethers.formatEther(dstImmutables.safetyDeposit)} ETH`)

    // Step 4: Demo escrow address calculation
    console.log('\n📍 Step 4: Calculating escrow addresses...')
    console.log(`   ✅ Source escrow would be deployed at: 0x${ethers.keccak256(ethers.solidityPacked(['bytes32', 'address'], [srcImmutables.orderHash, wallet.address])).substring(0, 40)}`)
    console.log(`   ✅ Destination escrow would be deployed at: 0x${ethers.keccak256(ethers.solidityPacked(['bytes32', 'address'], [dstImmutables.orderHash, wallet.address])).substring(0, 40)}`)

    // Step 5: Demo swap flow
    console.log('\n🔄 Step 5: Demo swap flow...')
    console.log('   1. Deploy EscrowFactory and Resolver contracts on both chains')
    console.log('   2. Fund resolver with USDC on destination chain')
    console.log('   3. Approve USDC spending on source chain')
    console.log('   4. Deploy source escrow and transfer USDC to it')
    console.log('   5. Deploy destination escrow')
    console.log('   6. Fill destination escrow with USDC')
    console.log('   7. Reveal secret on source chain to complete swap')

    // Step 6: Demo final verification
    console.log('\n✅ Step 6: Demo verification...')
    console.log('   - Source escrow would be deployed at: 0x' + ethers.keccak256(ethers.solidityPacked(['bytes32', 'address'], [srcImmutables.orderHash, wallet.address])).substring(0, 40))
    console.log('   - Destination escrow would be deployed at: 0x' + ethers.keccak256(ethers.solidityPacked(['bytes32', 'address'], [dstImmutables.orderHash, wallet.address])).substring(0, 40))
    console.log('   - USDC would be locked in source escrow:', ethers.formatUnits(swapAmount, 6))
    console.log('   - USDC would be locked in destination escrow:', ethers.formatUnits(swapAmount, 6))
    console.log('   - Secret would be revealed:', secret)
    console.log('   - Hashlock would be used:', hashlock)

    console.log('\n🎉 Demo completed successfully!')
    console.log('\n📋 To run the actual swap:')
    console.log('   1. Ensure you have sufficient ETH for gas fees on both chains')
    console.log('   2. Ensure you have USDC tokens on both chains')
    console.log('   3. Use reliable RPC endpoints with higher gas limits')
    console.log('   4. Run: pnpm run swap')
    
    console.log('\n🔗 Chain Information:')
    console.log(`   Source Chain (Sepolia): ${config.chain.source.chainId}`)
    console.log(`   Destination Chain (Arbitrum Sepolia): ${config.chain.destination.chainId}`)
    console.log(`   Source USDC: ${config.chain.source.tokens.USDC.address}`)
    console.log(`   Destination USDC: ${config.chain.destination.tokens.USDC.address}`)
}

// Run the demo
main().catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
}) 