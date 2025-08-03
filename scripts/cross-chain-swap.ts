#!/usr/bin/env node

import 'dotenv/config'
import { ethers } from 'ethers'
import { CustomSDK as Sdk } from '../tests/custom-sdk'
import { config } from '../tests/config'
import { uint8ArrayToHex, randomBytes, UINT_40_MAX } from '../tests/utils'
import factoryContract from '../dist/contracts/TestEscrowFactory.sol/TestEscrowFactory.json'
import resolverContract from '../dist/contracts/Resolver.sol/Resolver.json'

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

interface ChainSetup {
    provider: ethers.JsonRpcProvider
    escrowFactory: string
    resolver: string
    user: ethers.Wallet
    resolverContract: ethers.Contract
    escrowFactoryContract: ethers.Contract
    token: ethers.Contract
}

async function main() {
    console.log('🚀 Starting Cross-Chain Swap: Sepolia → Arbitrum Sepolia')
    console.log('=' * 60)

    // Validate environment variables
    const privateKey = process.env.PRIVATE_KEY
    if (!privateKey) {
        throw new Error('PRIVATE_KEY environment variable is required')
    }

    if (!process.env.SRC_CHAIN_RPC || !process.env.DST_CHAIN_RPC) {
        throw new Error('SRC_CHAIN_RPC and DST_CHAIN_RPC environment variables are required')
    }

    console.log('✅ Environment variables validated')

    // Setup chains
    const srcChain = await setupChain(config.chain.source, privateKey, 'Source (Sepolia)')
    const dstChain = await setupChain(config.chain.destination, privateKey, 'Destination (Arbitrum Sepolia)')

    // Perform the swap
    await performCrossChainSwap(srcChain, dstChain)
}

async function setupChain(
    chainConfig: any, 
    privateKey: string, 
    chainName: string
): Promise<ChainSetup> {
    console.log(`\n🔧 Setting up ${chainName} chain...`)

    // Create provider
    const provider = new ethers.JsonRpcProvider(chainConfig.url, chainConfig.chainId, {
        cacheTimeout: -1,
        staticNetwork: true
    })

    // Create wallet
    const user = new ethers.Wallet(privateKey, provider)
    console.log(`   User address: ${user.address}`)

    // Deploy contracts if needed (or use existing addresses)
    const { escrowFactory, resolver } = await deployContracts(provider, user, chainConfig)

    // Create contract instances
    const resolverContract = new ethers.Contract(resolver, resolverContract.abi, user)
    const escrowFactoryContract = new ethers.Contract(escrowFactory, factoryContract.abi, user)
    const token = new ethers.Contract(chainConfig.tokens.USDC.address, ERC20_ABI, user)

    console.log(`   ✅ ${chainName} setup complete`)
    console.log(`   Escrow Factory: ${escrowFactory}`)
    console.log(`   Resolver: ${resolver}`)

    return {
        provider,
        escrowFactory,
        resolver,
        user,
        resolverContract,
        escrowFactoryContract,
        token
    }
}

async function deployContracts(
    provider: ethers.JsonRpcProvider,
    deployer: ethers.Wallet,
    chainConfig: any
): Promise<{ escrowFactory: string; resolver: string }> {
    console.log('   Deploying contracts...')

    // Deploy EscrowFactory
    const escrowFactoryFactory = new ethers.ContractFactory(
        factoryContract.abi,
        factoryContract.bytecode,
        deployer
    )
    
    const escrowFactory = await escrowFactoryFactory.deploy(
        chainConfig.limitOrderProtocol,
        chainConfig.wrappedNative,
        '0x0000000000000000000000000000000000000000', // accessToken
        deployer.address, // owner
        60 * 30, // src rescue delay
        60 * 30 // dst rescue delay
    )
    await escrowFactory.waitForDeployment()
    const escrowFactoryAddress = await escrowFactory.getAddress()
    console.log(`   EscrowFactory deployed: ${escrowFactoryAddress}`)

    // Deploy Resolver
    const resolverFactory = new ethers.ContractFactory(
        resolverContract.abi,
        resolverContract.bytecode,
        deployer
    )
    
    const resolver = await resolverFactory.deploy(
        escrowFactoryAddress,
        chainConfig.limitOrderProtocol,
        deployer.address // resolver as owner
    )
    await resolver.waitForDeployment()
    const resolverAddress = await resolver.getAddress()
    console.log(`   Resolver deployed: ${resolverAddress}`)

    return {
        escrowFactory: escrowFactoryAddress,
        resolver: resolverAddress
    }
}

async function performCrossChainSwap(srcChain: ChainSetup, dstChain: ChainSetup) {
    console.log('\n🔄 Performing Cross-Chain Swap')
    console.log('=' * 40)

    const swapAmount = ethers.parseUnits('0.1', 6) // 0.1 USDC
    const safetyDeposit = ethers.parseEther('0.001') // 0.001 ETH

    // Get initial balances
    const initialSrcBalance = await srcChain.token.balanceOf(srcChain.user.address)
    const initialDstBalance = await dstChain.token.balanceOf(dstChain.user.address)
    const initialSrcEth = await srcChain.provider.getBalance(srcChain.user.address)
    const initialDstEth = await dstChain.provider.getBalance(dstChain.user.address)

    console.log('📊 Initial Balances:')
    console.log(`   Source USDC: ${ethers.formatUnits(initialSrcBalance, 6)}`)
    console.log(`   Destination USDC: ${ethers.formatUnits(initialDstBalance, 6)}`)
    console.log(`   Source ETH: ${ethers.formatEther(initialSrcEth)}`)
    console.log(`   Destination ETH: ${ethers.formatEther(initialDstEth)}`)

    // Step 1: Fund the resolver on destination chain
    console.log('\n💰 Funding resolver on destination chain...')
    const resolverDstBalance = await dstChain.token.balanceOf(dstChain.resolver)
    console.log(`   Resolver current balance: ${ethers.formatUnits(resolverDstBalance, 6)} USDC`)

    if (resolverDstBalance < swapAmount) {
        console.log('   Funding resolver with USDC...')
        const fundAmount = swapAmount * 2n // Fund with 2x the swap amount
        const fundTx = await dstChain.token.transfer(dstChain.resolver, fundAmount)
        await fundTx.wait()
        console.log(`   ✅ Funded resolver with ${ethers.formatUnits(fundAmount, 6)} USDC`)
    }

    // Step 2: Create the order
    console.log('\n📝 Creating cross-chain order...')
    const secret = uint8ArrayToHex(randomBytes(32))
    const hashlock = Sdk.HashLock.forSingleFill(secret)
    
    const order = Sdk.CrossChainOrder.new(
        srcChain.escrowFactory,
        {
            salt: Sdk.randBigInt(1000n),
            maker: srcChain.user.address,
            makingAmount: swapAmount,
            takingAmount: swapAmount, // 1:1 swap for simplicity
            makerAsset: config.chain.source.tokens.USDC.address,
            takerAsset: config.chain.destination.tokens.USDC.address
        },
        {
            nonce: Sdk.randBigInt(UINT_40_MAX),
            allowPartialFills: false,
            allowMultipleFills: false
        }
    )

    const orderHash = order.getOrderHash(config.chain.source.chainId)
    console.log(`   Order hash: ${orderHash}`)

    // Step 3: Approve USDC spending on source chain
    console.log('\n✅ Approving USDC spending on source chain...')
    const approveTx = await srcChain.token.approve(srcChain.escrowFactory, swapAmount)
    await approveTx.wait()
    console.log('   ✅ USDC approval confirmed')

    // Step 4: Create source escrow immutables
    const srcImmutables = order.toSrcImmutables(
        config.chain.source.chainId,
        srcChain.user.address, // taker
        swapAmount,
        hashlock
    )

    // Step 5: Calculate and deploy source escrow
    console.log('\n🏗️ Deploying source escrow...')
    const srcEscrowAddress = new Sdk.EscrowFactory(srcChain.escrowFactory).getSrcEscrowAddress(
        srcImmutables,
        await srcChain.escrowFactoryContract.ESCROW_SRC_IMPLEMENTATION()
    )
    console.log(`   Source escrow address: ${srcEscrowAddress}`)

    const deploySrcEscrowTx = await srcChain.escrowFactoryContract.createEscrow(
        srcImmutables.orderHash,
        srcImmutables.hashlock,
        srcImmutables.maker,
        srcImmutables.taker,
        srcImmutables.token,
        srcImmutables.amount,
        srcImmutables.safetyDeposit,
        srcImmutables.timelocks,
        { value: safetyDeposit }
    )
    await deploySrcEscrowTx.wait()
    console.log('   ✅ Source escrow deployed')

    // Step 6: Transfer USDC to source escrow
    console.log('\n💸 Transferring USDC to source escrow...')
    const transferTx = await srcChain.token.transfer(srcEscrowAddress, swapAmount)
    await transferTx.wait()
    console.log('   ✅ USDC transferred to source escrow')

    // Step 7: Create and deploy destination escrow
    console.log('\n🏗️ Deploying destination escrow...')
    const dstImmutables = {
        ...srcImmutables,
        taker: dstChain.user.address,
        amount: swapAmount,
        token: config.chain.destination.tokens.USDC.address,
        safetyDeposit: safetyDeposit,
        timelocks: srcImmutables.timelocks
    }

    const dstEscrowAddress = new Sdk.EscrowFactory(dstChain.escrowFactory).getDstEscrowAddress(
        dstImmutables,
        {
            amount: swapAmount,
            token: config.chain.destination.tokens.USDC.address,
            safetyDeposit: safetyDeposit
        },
        Math.floor(Date.now() / 1000), // deployedAt
        dstChain.user.address, // taker
        await dstChain.escrowFactoryContract.ESCROW_DST_IMPLEMENTATION()
    )
    console.log(`   Destination escrow address: ${dstEscrowAddress}`)

    const deployDstEscrowTx = await dstChain.escrowFactoryContract.createEscrow(
        dstImmutables.orderHash,
        dstImmutables.hashlock,
        dstImmutables.maker,
        dstImmutables.taker,
        dstImmutables.token,
        dstImmutables.amount,
        dstImmutables.safetyDeposit,
        dstImmutables.timelocks,
        { value: safetyDeposit }
    )
    await deployDstEscrowTx.wait()
    console.log('   ✅ Destination escrow deployed')

    // Step 8: Fill destination escrow
    console.log('\n🔄 Filling destination escrow...')
    const dstEscrow = new ethers.Contract(dstEscrowAddress, ESCROW_ABI, dstChain.user)
    
    // Approve USDC spending for resolver
    const resolverApproveTx = await dstChain.token.approve(dstEscrowAddress, swapAmount)
    await resolverApproveTx.wait()

    // Fill the escrow
    const fillTx = await dstEscrow.fill(
        '0x', // order data
        '0x', // signature
        '0x', // interaction data
        { value: 0 }
    )
    await fillTx.wait()
    console.log('   ✅ Destination escrow filled')

    // Step 9: Reveal secret on source chain
    console.log('\n🔓 Revealing secret on source chain...')
    const srcEscrow = new ethers.Contract(srcEscrowAddress, ESCROW_ABI, srcChain.user)
    const revealTx = await srcEscrow.fill(
        '0x', // order data
        '0x', // signature
        ethers.toUtf8Bytes(secret), // interaction data with secret
        { value: 0 }
    )
    await revealTx.wait()
    console.log('   ✅ Secret revealed, swap completed')

    // Step 10: Check final balances
    const finalSrcBalance = await srcChain.token.balanceOf(srcChain.user.address)
    const finalDstBalance = await dstChain.token.balanceOf(dstChain.user.address)
    const finalSrcEth = await srcChain.provider.getBalance(srcChain.user.address)
    const finalDstEth = await dstChain.provider.getBalance(dstChain.user.address)

    console.log('\n📊 Final Balances:')
    console.log(`   Source USDC: ${ethers.formatUnits(finalSrcBalance, 6)}`)
    console.log(`   Destination USDC: ${ethers.formatUnits(finalDstBalance, 6)}`)
    console.log(`   Source ETH: ${ethers.formatEther(finalSrcEth)}`)
    console.log(`   Destination ETH: ${ethers.formatEther(finalDstEth)}`)

    // Step 11: Verify swap success
    const srcEscrowBalance = await srcChain.token.balanceOf(srcEscrowAddress)
    const dstEscrowBalance = await dstChain.token.balanceOf(dstEscrowAddress)

    console.log('\n🎉 Swap Summary:')
    console.log(`   Order hash: ${orderHash}`)
    console.log(`   Source escrow: ${srcEscrowAddress}`)
    console.log(`   Destination escrow: ${dstEscrowAddress}`)
    console.log(`   USDC locked in source escrow: ${ethers.formatUnits(srcEscrowBalance, 6)}`)
    console.log(`   USDC locked in destination escrow: ${ethers.formatUnits(dstEscrowBalance, 6)}`)
    console.log(`   Secret: ${secret}`)
    console.log(`   Hashlock: ${hashlock}`)
    console.log(`   Destination balance increase: ${ethers.formatUnits(finalDstBalance - initialDstBalance, 6)} USDC`)

    if (finalDstBalance > initialDstBalance) {
        console.log('\n✅ Cross-chain swap completed successfully!')
    } else {
        console.log('\n❌ Swap may not have completed as expected')
    }
}

// Run the script
main().catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
}) 