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

async function main() {
    console.log('🚀 Cross-Chain Swap (Simple Version): Sepolia → Arbitrum Sepolia')
    console.log('='.repeat(70))

    // Validate environment variables
    const privateKey = process.env.PRIVATE_KEY
    if (!privateKey) {
        throw new Error('PRIVATE_KEY environment variable is required')
    }

    if (!process.env.SRC_CHAIN_RPC || !process.env.DST_CHAIN_RPC) {
        throw new Error('SRC_CHAIN_RPC and DST_CHAIN_RPC environment variables are required')
    }

    console.log('✅ Environment variables validated')

    // Check RPC endpoints and provide recommendations
    await checkRpcEndpoints()
    
    // Show the complete swap flow without actually deploying
    await showSwapFlow(privateKey)
}

async function checkRpcEndpoints() {
    console.log('\n🔍 Checking RPC Endpoints...')
    
    const srcRpc = process.env.SRC_CHAIN_RPC
    const dstRpc = process.env.DST_CHAIN_RPC
    
    console.log(`   Source RPC: ${srcRpc}`)
    console.log(`   Destination RPC: ${dstRpc}`)
    
    // Check if using public RPCs with low gas limits
    const publicRpcs = [
        'https://eth.merkle.io',
        'https://arbitrum-sepolia.publicnode.com',
        'https://rpc.sepolia.org',
        'https://sepolia-rollup.arbitrum.io/rpc'
    ]
    
    const isPublicSrc = publicRpcs.some(rpc => srcRpc.includes(rpc.split('//')[1].split('/')[0]))
    const isPublicDst = publicRpcs.some(rpc => dstRpc.includes(rpc.split('//')[1].split('/')[0]))
    
    if (isPublicSrc || isPublicDst) {
        console.log('\n⚠️  Warning: Using public RPC endpoints detected!')
        console.log('   These endpoints often have low gas limits (1,000,000 gas)')
        console.log('   which may be insufficient for contract deployment.')
        console.log('\n💡 Recommendations:')
        console.log('   1. Use a service like Alchemy, Infura, or QuickNode')
        console.log('   2. Use Anvil (local fork) for testing')
        console.log('   3. Use the demo script: pnpm run demo')
        console.log('\n📋 Alternative RPC endpoints:')
        console.log('   Sepolia: https://sepolia.infura.io/v3/YOUR_API_KEY')
        console.log('   Arbitrum Sepolia: https://arbitrum-sepolia.infura.io/v3/YOUR_API_KEY')
    }
}

async function showSwapFlow(privateKey) {
    console.log('\n🎭 Cross-Chain Swap Flow Demonstration')
    console.log('='.repeat(50))

    // Create wallet
    const wallet = new ethers.Wallet(privateKey)
    console.log(`   Wallet address: ${wallet.address}`)

    // Swap parameters
    const swapAmount = ethers.parseUnits('0.1', 6) // 0.1 USDC
    const safetyDeposit = ethers.parseEther('0.001') // 0.001 ETH

    console.log('\n📊 Swap Parameters:')
    console.log(`   Swap amount: ${ethers.formatUnits(swapAmount, 6)} USDC`)
    console.log(`   Safety deposit: ${ethers.formatEther(safetyDeposit)} ETH`)

    // Step 1: Create order
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
            takingAmount: swapAmount,
            makerAsset: config.chain.source.tokens.USDC.address,
            takerAsset: config.chain.destination.tokens.USDC.address
        },
        {
            allowPartialFills: false,
            allowMultipleFills: false
        }
    )

    const orderHash = order.getOrderHash(config.chain.source.chainId)
    console.log(`   ✅ Order hash: ${orderHash}`)
    console.log(`   ✅ Secret: ${secret.substring(0, 10)}...`)
    console.log(`   ✅ Hashlock: ${hashlock.substring(0, 10)}...`)

    // Step 2: Create escrow immutables
    console.log('\n🏗️ Step 2: Creating escrow immutables...')
    const srcImmutables = order.toSrcImmutables(
        config.chain.source.chainId,
        wallet.address,
        swapAmount,
        hashlock
    )
    
    const dstImmutables = {
        ...srcImmutables,
        taker: wallet.address,
        amount: swapAmount,
        token: config.chain.destination.tokens.USDC.address,
        safetyDeposit: safetyDeposit,
        timelocks: srcImmutables.timelocks
    }
    
    console.log(`   ✅ Source escrow immutables created`)
    console.log(`   ✅ Destination escrow immutables created`)

    // Step 3: Calculate escrow addresses
    console.log('\n📍 Step 3: Calculating escrow addresses...')
    const srcEscrowAddress = '0x' + ethers.keccak256(ethers.solidityPacked(['bytes32', 'address'], [srcImmutables.orderHash, wallet.address])).substring(0, 40)
    const dstEscrowAddress = '0x' + ethers.keccak256(ethers.solidityPacked(['bytes32', 'address'], [dstImmutables.orderHash, wallet.address])).substring(0, 40)
    
    console.log(`   ✅ Source escrow: ${srcEscrowAddress}`)
    console.log(`   ✅ Destination escrow: ${dstEscrowAddress}`)

    // Step 4: Show complete swap process
    console.log('\n🔄 Complete Cross-Chain Swap Process:')
    console.log('='.repeat(50))
    
    console.log('\n1️⃣  Setup Phase:')
    console.log('   • Deploy EscrowFactory on Sepolia')
    console.log('   • Deploy Resolver on Sepolia')
    console.log('   • Deploy EscrowFactory on Arbitrum Sepolia')
    console.log('   • Deploy Resolver on Arbitrum Sepolia')
    console.log('   • Fund resolver with USDC on Arbitrum Sepolia')
    
    console.log('\n2️⃣  Order Phase:')
    console.log('   • Create cross-chain order with secret')
    console.log('   • Generate hashlock from secret')
    console.log('   • Calculate escrow addresses')
    
    console.log('\n3️⃣  Source Chain (Sepolia):')
    console.log('   • Approve USDC spending for EscrowFactory')
    console.log('   • Deploy source escrow with USDC')
    console.log('   • USDC locked in source escrow')
    
    console.log('\n4️⃣  Destination Chain (Arbitrum Sepolia):')
    console.log('   • Deploy destination escrow')
    console.log('   • Resolver fills destination escrow with USDC')
    console.log('   • USDC locked in destination escrow')
    
    console.log('\n5️⃣  Completion Phase:')
    console.log('   • Reveal secret on source chain')
    console.log('   • Source escrow releases USDC to taker')
    console.log('   • Destination escrow releases USDC to maker')
    console.log('   • Swap completed successfully!')

    // Step 5: Show transaction details
    console.log('\n📋 Transaction Details:')
    console.log('='.repeat(30))
    console.log(`   Order Hash: ${orderHash}`)
    console.log(`   Secret: ${secret}`)
    console.log(`   Hashlock: ${hashlock}`)
    console.log(`   Source Escrow: ${srcEscrowAddress}`)
    console.log(`   Destination Escrow: ${dstEscrowAddress}`)
    console.log(`   Source USDC: ${config.chain.source.tokens.USDC.address}`)
    console.log(`   Destination USDC: ${config.chain.destination.tokens.USDC.address}`)
    console.log(`   Swap Amount: ${ethers.formatUnits(swapAmount, 6)} USDC`)
    console.log(`   Safety Deposit: ${ethers.formatEther(safetyDeposit)} ETH`)

    // Step 6: Gas estimation
    console.log('\n⛽ Gas Requirements:')
    console.log('='.repeat(30))
    console.log('   EscrowFactory deployment: ~2,000,000 gas')
    console.log('   Resolver deployment: ~1,500,000 gas')
    console.log('   Source escrow deployment: ~1,000,000 gas')
    console.log('   Destination escrow deployment: ~1,000,000 gas')
    console.log('   USDC approval: ~50,000 gas')
    console.log('   USDC transfer: ~65,000 gas')
    console.log('   Secret revelation: ~50,000 gas')
    console.log('   Total estimated: ~5,665,000 gas')

    console.log('\n💡 To run the actual swap:')
    console.log('   1. Use RPC endpoints with higher gas limits (>6,000,000)')
    console.log('   2. Ensure sufficient ETH for gas fees on both chains')
    console.log('   3. Ensure USDC tokens on both chains')
    console.log('   4. Run: pnpm run swap')
    
    console.log('\n🎉 Flow demonstration completed!')
}

// Run the script
main().catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
}) 