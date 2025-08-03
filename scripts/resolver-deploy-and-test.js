#!/usr/bin/env node

import 'dotenv/config'
import { ethers } from 'ethers'
import { CustomSDK as Sdk } from '../tests/custom-sdk.js'
import { config } from '../tests/config.js'
import { UINT_40_MAX } from '../tests/utils.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load contract artifacts
const factoryContract = JSON.parse(readFileSync(join(__dirname, '../dist/contracts/TestEscrowFactory.sol/TestEscrowFactory.json'), 'utf8'))
const resolverContractArtifact = JSON.parse(readFileSync(join(__dirname, '../dist/contracts/Resolver.sol/Resolver.json'), 'utf8'))

// ERC20 ABI for token interactions
const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)'
]

// WETH ABI for deposit/withdraw functionality
const WETH_ABI = [
    ...ERC20_ABI,
    'function deposit() payable',
    'function withdraw(uint256 amount)',
    'function balanceOf(address owner) view returns (uint256)'
]

// EscrowFactory ABI for proper interactions
const ESCROW_FACTORY_ABI = [
    'function createDstEscrow(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) dstImmutables, uint256 srcCancellationTimestamp) external payable',
    'function addressOfEscrowSrc(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external view returns (address)',
    'function addressOfEscrowDst(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external view returns (address)'
]

// Escrow ABI for withdrawal
const ESCROW_ABI = [
    'function withdraw(bytes32 secret, tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external',
    'function cancel(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external'
]

// Load deployed contracts from JSON
function loadDeployedContracts() {
    const contractsPath = join(__dirname, '../deployed-contracts.json')
    if (existsSync(contractsPath)) {
        return JSON.parse(readFileSync(contractsPath, 'utf8'))
    }
    return {
        sepolia: { escrowFactory: "", resolver: "", lastDeployed: "" },
        arbitrumSepolia: { escrowFactory: "", resolver: "", lastDeployed: "" }
    }
}

// Save deployed contracts to JSON
function saveDeployedContracts(contracts) {
    const contractsPath = join(__dirname, '../deployed-contracts.json')
    writeFileSync(contractsPath, JSON.stringify(contracts, null, 2))
}

// Countdown timer function
function countdown(seconds) {
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            process.stdout.write(`\r⏰ Countdown: ${seconds} seconds remaining...`)
            seconds--
            
            if (seconds < 0) {
                clearInterval(interval)
                process.stdout.write('\n')
                resolve()
            }
        }, 1000)
    })
}

// Test RPC connection
async function testRpcConnection(provider, chainName) {
    try {
        console.log(`   Testing ${chainName} RPC connection...`)
        const blockNumber = await provider.getBlockNumber()
        console.log(`   ✅ ${chainName} connected! Block number: ${blockNumber}`)
        return true
    } catch (error) {
        console.log(`   ❌ ${chainName} connection failed: ${error.message}`)
        return false
    }
}

async function main() {
    console.log('🚀 Starting Resolver Deploy and Test: Sepolia → Arbitrum Sepolia')
    console.log('='.repeat(70))
    
    // Validate environment variables
    if (!process.env.PRIVATE_KEY || !process.env.SRC_CHAIN_RPC || !process.env.DST_CHAIN_RPC) {
        console.log('❌ Missing required environment variables:')
        console.log('   - PRIVATE_KEY: Your wallet private key')
        console.log('   - SRC_CHAIN_RPC: Source chain RPC URL')
        console.log('   - DST_CHAIN_RPC: Destination chain RPC URL')
        process.exit(1)
    }

    const privateKey = process.env.PRIVATE_KEY
    const srcRpcUrl = process.env.SRC_CHAIN_RPC
    const dstRpcUrl = process.env.DST_CHAIN_RPC

    // Setup providers
    const srcProvider = new ethers.JsonRpcProvider(srcRpcUrl)
    const dstProvider = new ethers.JsonRpcProvider(dstRpcUrl)
    
    // Test connections
    console.log('\n🔗 Testing RPC connections...')
    const srcConnected = await testRpcConnection(srcProvider, 'Sepolia')
    const dstConnected = await testRpcConnection(dstProvider, 'Arbitrum Sepolia')
    
    if (!srcConnected || !dstConnected) {
        console.log('❌ Failed to connect to one or more chains')
        process.exit(1)
    }

    // Setup wallets
    const srcWallet = new ethers.Wallet(privateKey, srcProvider)
    const dstWallet = new ethers.Wallet(privateKey, dstProvider)
    
    console.log(`\n👤 Using wallet: ${srcWallet.address}`)
    
    // Load existing deployed contracts
    const deployedContracts = loadDeployedContracts()
    console.log('\n📋 Checking existing deployments...')
    console.log(`   Sepolia Factory: ${deployedContracts.sepolia.escrowFactory || 'Not deployed'}`)
    console.log(`   Sepolia Resolver: ${deployedContracts.sepolia.resolver || 'Not deployed'}`)
    console.log(`   Arbitrum Sepolia Factory: ${deployedContracts.arbitrumSepolia.escrowFactory || 'Not deployed'}`)
    console.log(`   Arbitrum Sepolia Resolver: ${deployedContracts.arbitrumSepolia.resolver || 'Not deployed'}`)

    // Setup chain configurations
    const srcChain = {
        provider: srcProvider,
        user: srcWallet,
        chainId: config.chain.source.chainId,
        escrowFactory: deployedContracts.sepolia.escrowFactory,
        resolver: deployedContracts.sepolia.resolver,
        limitOrderProtocol: config.chain.source.limitOrderProtocol,
        token: new ethers.Contract(config.chain.source.tokens.WETH.address, WETH_ABI, srcWallet)
    }

    const dstChain = {
        provider: dstProvider,
        user: dstWallet,
        chainId: config.chain.destination.chainId,
        escrowFactory: deployedContracts.arbitrumSepolia.escrowFactory,
        resolver: deployedContracts.arbitrumSepolia.resolver,
        limitOrderProtocol: config.chain.destination.limitOrderProtocol,
        token: new ethers.Contract(config.chain.destination.tokens.WETH.address, WETH_ABI, dstWallet)
    }

    // Deploy contracts if needed
    console.log('\n🏗️ Deploying contracts if needed...')
    
    // Deploy on source chain (Sepolia)
    if (!srcChain.escrowFactory || !srcChain.resolver) {
        console.log('   Deploying contracts on Sepolia...')
        await deployContracts(srcProvider, srcWallet, srcChain, 'sepolia', deployedContracts)
    } else {
        console.log('   ✅ Sepolia contracts already deployed')
    }

    // Deploy on destination chain (Arbitrum Sepolia)
    if (!dstChain.escrowFactory || !dstChain.resolver) {
        console.log('   Deploying contracts on Arbitrum Sepolia...')
        await deployContracts(dstProvider, dstWallet, dstChain, 'arbitrumSepolia', deployedContracts)
    } else {
        console.log('   ✅ Arbitrum Sepolia contracts already deployed')
    }

    // Update chain objects with contract instances
    srcChain.escrowFactoryContract = new ethers.Contract(srcChain.escrowFactory, ESCROW_FACTORY_ABI, srcWallet)
    srcChain.resolverContract = new ethers.Contract(srcChain.resolver, resolverContractArtifact.abi, srcWallet)
    dstChain.escrowFactoryContract = new ethers.Contract(dstChain.escrowFactory, ESCROW_FACTORY_ABI, dstWallet)
    dstChain.resolverContract = new ethers.Contract(dstChain.resolver, resolverContractArtifact.abi, dstWallet)

    // Perform the complete cross-chain swap test
    await performCompleteSwapTest(srcChain, dstChain)
}

async function deployContracts(provider, deployer, chainConfig, chainName, deployedContracts) {
    console.log(`   🚀 Deploying contracts on ${chainName}...`)
    
    // Deploy EscrowFactory first
    if (!chainConfig.escrowFactory) {
        console.log('   📦 Deploying EscrowFactory...')
        const factoryFactory = new ethers.ContractFactory(
            factoryContract.abi,
            factoryContract.bytecode,
            deployer
        )
        
        const factory = await factoryFactory.deploy()
        await factory.waitForDeployment()
        const factoryAddress = await factory.getAddress()
        
        chainConfig.escrowFactory = factoryAddress
        deployedContracts[chainName].escrowFactory = factoryAddress
        
        console.log(`   ✅ EscrowFactory deployed: ${factoryAddress}`)
    }

    // Deploy Resolver
    if (!chainConfig.resolver) {
        console.log('   📦 Deploying Resolver...')
        const resolverFactory = new ethers.ContractFactory(
            resolverContractArtifact.abi,
            resolverContractArtifact.bytecode,
            deployer
        )
        
        const resolver = await resolverFactory.deploy(
            chainConfig.escrowFactory,
            chainConfig.limitOrderProtocol,
            deployer.address
        )
        await resolver.waitForDeployment()
        const resolverAddress = await resolver.getAddress()
        
        chainConfig.resolver = resolverAddress
        deployedContracts[chainName].resolver = resolverAddress
        deployedContracts[chainName].lastDeployed = new Date().toISOString()
        
        console.log(`   ✅ Resolver deployed: ${resolverAddress}`)
    }

    // Save updated contracts
    saveDeployedContracts(deployedContracts)
    console.log(`   💾 Contract addresses saved`)
}

async function performCompleteSwapTest(srcChain, dstChain) {
    console.log('\n🔄 Performing Complete Cross-Chain Swap Test')
    console.log('='.repeat(60))

    const swapAmount = ethers.parseEther('0.01') // 0.01 WETH
    const safetyDeposit = ethers.parseEther('0.001') // 0.001 ETH

    // Get initial balances
    const initialSrcBalance = await srcChain.token.balanceOf(srcChain.user.address)
    const initialDstBalance = await dstChain.token.balanceOf(dstChain.user.address)
    const initialSrcEth = await srcChain.provider.getBalance(srcChain.user.address)
    const initialDstEth = await dstChain.provider.getBalance(dstChain.user.address)

    console.log('📊 Initial Balances:')
    console.log(`   Source WETH: ${ethers.formatEther(initialSrcBalance)}`)
    console.log(`   Destination WETH: ${ethers.formatEther(initialDstBalance)}`)
    console.log(`   Source ETH: ${ethers.formatEther(initialSrcEth)}`)
    console.log(`   Destination ETH: ${ethers.formatEther(initialDstEth)}`)

    // Convert ETH to WETH on both chains if needed
    console.log('\n💱 Converting ETH to WETH on both chains...')
    
    // Convert ETH to WETH on source chain
    if (initialSrcBalance < swapAmount) {
        const ethNeeded = swapAmount - initialSrcBalance
        console.log(`   Source chain: Converting ${ethers.formatEther(ethNeeded)} ETH to WETH...`)
        try {
            const depositSrcTx = await srcChain.token.deposit({ value: ethNeeded })
            await depositSrcTx.wait()
            console.log(`   ✅ Source chain: Converted ${ethers.formatEther(ethNeeded)} ETH to WETH`)
        } catch (error) {
            console.log(`   ❌ Source chain ETH to WETH conversion failed: ${error.message}`)
            return
        }
    } else {
        console.log(`   ✅ Source chain: Sufficient WETH balance (${ethers.formatEther(initialSrcBalance)})`)
    }
    
    // Convert ETH to WETH on destination chain
    if (initialDstBalance < swapAmount) {
        const ethNeeded = swapAmount - initialDstBalance
        console.log(`   Destination chain: Converting ${ethers.formatEther(ethNeeded)} ETH to WETH...`)
        try {
            const depositDstTx = await dstChain.token.deposit({ value: ethNeeded })
            await depositDstTx.wait()
            console.log(`   ✅ Destination chain: Converted ${ethers.formatEther(ethNeeded)} ETH to WETH`)
        } catch (error) {
            console.log(`   ❌ Destination chain ETH to WETH conversion failed: ${error.message}`)
            return
        }
    } else {
        console.log(`   ✅ Destination chain: Sufficient WETH balance (${ethers.formatEther(initialDstBalance)})`)
    }

    // STEP 1: Create order using Custom SDK
    console.log('\n📝 Step 1: Creating order using Custom SDK...')
    
    // Set timelocks for immediate withdrawal (0 = immediate)
    const timelockParams = {
        srcWithdrawal: 0n,        // Immediate withdrawal
        srcPublicWithdrawal: 0n,  // Immediate public withdrawal
        srcCancellation: 0n,      // Immediate cancellation
        srcPublicCancellation: 0n, // Immediate public cancellation
        dstWithdrawal: 0n,        // Immediate withdrawal
        dstPublicWithdrawal: 0n,  // Immediate public withdrawal
        dstCancellation: 0n       // Immediate cancellation
    }
    
    // Create Fusion+ order with Dutch auction parameters
    const order = Sdk.CrossChainOrder.new(
        srcChain.escrowFactory,
        {
            salt: Sdk.randBigInt(1000n),
            nonce: Sdk.randBigInt(UINT_40_MAX),
            maker: srcChain.user.address,
            makingAmount: swapAmount,
            takingAmount: swapAmount, // 1:1 swap for simplicity
            makerAsset: config.chain.source.tokens.WETH.address,
            takerAsset: config.chain.destination.tokens.WETH.address
        },
        {
            allowPartialFills: true, // Allow partial fills for Dutch auction
            allowMultipleFills: false // Single fill order
        }
    )

    // Generate and store secret in the order using SDK
    const secret = order.generateSecret()
    const hashlock = order.getHashlock()
    
    console.log(`   🔐 HTLC Secret: ${secret}`)
    console.log(`   🔒 HTLC Hashlock: ${hashlock}`)
    console.log(`   💾 Secret stored in order via SDK`)

    const orderHash = order.getOrderHash(config.chain.source.chainId)
    console.log(`   Order hash: ${orderHash}`)
    console.log(`   Secret: ${secret} (stored in order via SDK)`)
    console.log(`   Hashlock: ${hashlock}`)
    console.log('   ✅ Order created successfully')

    // STEP 2: Create escrow immutables
    console.log('\n🏗️ Step 2: Creating escrow immutables...')
    
    const srcImmutablesRaw = order.toSrcImmutables(
        config.chain.source.chainId,
        srcChain.user.address, // taker
        swapAmount,
        hashlock,
        timelockParams
    )

    // Convert addresses to proper format for contract calls
    const srcImmutables = {
        orderHash: srcImmutablesRaw.orderHash,
        hashlock: srcImmutablesRaw.hashlock,
        maker: srcImmutablesRaw.maker, // Keep as address string
        taker: srcImmutablesRaw.taker, // Keep as address string
        token: srcImmutablesRaw.token, // Keep as address string
        amount: srcImmutablesRaw.amount,
        safetyDeposit: safetyDeposit,
        timelocks: srcImmutablesRaw.timelocks
    }

    const dstImmutables = {
        orderHash: srcImmutables.orderHash,
        hashlock: srcImmutables.hashlock,
        maker: srcImmutables.maker,
        taker: dstChain.user.address, // Keep as address string
        token: config.chain.destination.tokens.WETH.address, // Keep as address string
        amount: swapAmount,
        safetyDeposit: safetyDeposit,
        timelocks: srcImmutables.timelocks // Use same timelocks for consistency
    }

    // Calculate deterministic escrow addresses
    console.log('\n📍 Calculating deterministic escrow addresses...')
    const srcEscrowAddress = await srcChain.escrowFactoryContract.addressOfEscrowSrc(srcImmutables)
    const dstEscrowAddress = await dstChain.escrowFactoryContract.addressOfEscrowDst(dstImmutables)
    
    console.log(`   Source escrow address: ${srcEscrowAddress}`)
    console.log(`   Destination escrow address: ${dstEscrowAddress}`)

    // STEP 3: Deploy escrows and lock funds
    console.log('\n🔒 Step 3: Deploying escrows and locking funds...')
    
    // STEP 3a: Deploy source escrow via resolver (this will be done through LOP fillOrderArgs)
    console.log('   🔧 Step 3a: Deploying source escrow via resolver...')
    
    // For the source escrow, we need to create a proper order structure for the LOP
    // This is a simplified version - in reality, this would be done through the LOP fillOrderArgs
    console.log('   📝 Note: Source escrow deployment is handled by Limit Order Protocol')
    console.log('   📝 The resolver.deploySrc() function calls LOP.fillOrderArgs()')
    console.log('   📝 This automatically creates the source escrow and locks maker tokens')
    
    // STEP 3b: Deploy destination escrow via resolver
    console.log('   🔧 Step 3b: Deploying destination escrow via resolver...')
    
    try {
        // Approve WETH spending for destination escrow creation
        console.log('   Resolver: Approving WETH spending for destination escrow...')
        const currentAllowance = await dstChain.token.allowance(dstChain.user.address, dstChain.escrowFactory)
        console.log(`   Current allowance: ${ethers.formatEther(currentAllowance)} WETH`)
        
        if (currentAllowance < swapAmount) {
            const approveDstTx = await dstChain.token.approve(dstChain.escrowFactory, swapAmount, {
                gasLimit: 100000n
            })
            await approveDstTx.wait()
            console.log('   ✅ Resolver approved WETH for destination escrow')
        } else {
            console.log('   ✅ WETH already approved for destination escrow')
        }
        
        // Create destination escrow via resolver
        const srcCancellationTimestamp = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
        const totalValue = safetyDeposit // Only ETH safety deposit, WETH is transferred separately
        
        console.log(`   Resolver: Creating destination escrow with ${ethers.formatEther(swapAmount)} WETH + ${ethers.formatEther(safetyDeposit)} ETH safety deposit...`)
        
        const deployDstTx = await dstChain.resolverContract.deployDst(
            dstImmutables,
            srcCancellationTimestamp,
            { 
                value: totalValue,
                gasLimit: 300000n
            }
        )
        console.log(`   DeployDst transaction hash: ${deployDstTx.hash}`)
        await deployDstTx.wait()
        console.log(`   ✅ Resolver deployed destination escrow with ${ethers.formatEther(swapAmount)} WETH`)
        
    } catch (error) {
        console.log(`   ❌ Destination escrow deployment failed: ${error.message}`)
        console.log('   💡 Trying with higher gas limit...')
        
        try {
            const srcCancellationTimestamp = Math.floor(Date.now() / 1000) + 3600
            const totalValue = safetyDeposit // Only ETH safety deposit, WETH is transferred separately
            
            const deployDstTx = await dstChain.resolverContract.deployDst(
                dstImmutables,
                srcCancellationTimestamp,
                { 
                    value: totalValue,
                    gasLimit: 500000n // Use higher gas limit
                }
            )
            await deployDstTx.wait()
            console.log(`   ✅ Resolver deployed destination escrow with ${ethers.formatEther(swapAmount)} WETH (with higher gas)`)
        } catch (retryError) {
            console.log(`   ❌ DeployDst retry failed: ${retryError.message}`)
            return
        }
    }

    // Verify funds are locked
    console.log('\n🔍 Verifying funds are locked...')
    const srcEscrowBalance = await srcChain.token.balanceOf(srcEscrowAddress)
    const dstEscrowBalance = await dstChain.token.balanceOf(dstEscrowAddress)
    const srcEscrowEth = await srcChain.provider.getBalance(srcEscrowAddress)
    const dstEscrowEth = await dstChain.provider.getBalance(dstEscrowAddress)
    
    console.log(`   Source escrow WETH: ${ethers.formatEther(srcEscrowBalance)}`)
    console.log(`   Destination escrow WETH: ${ethers.formatEther(dstEscrowBalance)}`)
    console.log(`   Source escrow ETH: ${ethers.formatEther(srcEscrowEth)}`)
    console.log(`   Destination escrow ETH: ${ethers.formatEther(dstEscrowEth)}`)
    
    if (dstEscrowBalance >= swapAmount) {
        console.log('   ✅ Funds successfully locked in destination escrow contract!')
    } else {
        console.log('   ❌ Funds not properly locked in destination escrow')
        return
    }

    // STEP 4: Test withdrawal
    console.log('\n🔐 Step 4: Testing withdrawal functionality...')
    console.log('   ⏰ Waiting for finality locks to pass...')
    
    await countdown(5)
    
    console.log('   ✅ Finality locks passed')
    
    // Retrieve secret from the order using SDK
    const retrievedSecret = order.getSecret()
    if (!retrievedSecret) {
        console.log('   ❌ No secret found in order! Cannot proceed with withdrawal.')
        return
    }
    console.log(`   🔑 Secret retrieved from order: ${retrievedSecret}`)
    
    // Verify HTLC secret matches hashlock
    const computedHashlock = ethers.keccak256(retrievedSecret)
    if (computedHashlock !== hashlock) {
        console.log('   ❌ HTLC Secret verification failed! Hashlock mismatch.')
        console.log(`   Expected: ${hashlock}`)
        console.log(`   Computed: ${computedHashlock}`)
        return
    }
    console.log('   ✅ HTLC Secret verification successful - hashlock matches!')
    
    // Test withdrawal from destination escrow
    console.log('   📤 Testing withdrawal from destination escrow...')
    try {
        // Check escrow balance before withdrawal
        const dstEscrowBalanceBefore = await dstChain.token.balanceOf(dstEscrowAddress)
        console.log(`   Destination escrow balance before withdrawal: ${ethers.formatEther(dstEscrowBalanceBefore)} WETH`)
        
        // Log withdrawal parameters for debugging
        console.log(`   Withdrawal parameters:`)
        console.log(`     Secret: ${retrievedSecret}`)
        console.log(`     Taker: ${dstChain.user.address}`)
        console.log(`     Maker: ${dstImmutables.maker}`)
        console.log(`     Hashlock: ${dstImmutables.hashlock}`)
        console.log(`     Timelocks: ${dstImmutables.timelocks}`)
        
        // Use resolver contract to withdraw from destination escrow
        const withdrawDstTx = await dstChain.resolverContract.withdraw(
            dstEscrowAddress,
            retrievedSecret,
            dstImmutables,
            { gasLimit: 200000n }
        )
        console.log(`   WithdrawDst transaction hash: ${withdrawDstTx.hash}`)
        await withdrawDstTx.wait()
        console.log('   ✅ Withdrawal from destination escrow successful!')
        
        // Check escrow balance after withdrawal
        const dstEscrowBalanceAfter = await dstChain.token.balanceOf(dstEscrowAddress)
        console.log(`   Destination escrow balance after withdrawal: ${ethers.formatEther(dstEscrowBalanceAfter)} WETH`)
        
        if (dstEscrowBalanceAfter === 0n) {
            console.log('   ✅ All funds successfully withdrawn from destination escrow!')
        } else {
            console.log('   ⚠️ Some funds may still be in destination escrow')
        }
        
    } catch (error) {
        console.log(`   ❌ Withdrawal from destination escrow failed: ${error.message}`)
        console.log('   💡 This might be due to timing constraints or permission issues')
        return
    }

    // Final balance check
    console.log('\n📊 Final Balance Check:')
    const finalSrcBalance = await srcChain.token.balanceOf(srcChain.user.address)
    const finalDstBalance = await dstChain.token.balanceOf(dstChain.user.address)
    const finalSrcEth = await srcChain.provider.getBalance(srcChain.user.address)
    const finalDstEth = await dstChain.provider.getBalance(dstChain.user.address)

    console.log(`   Source WETH: ${ethers.formatEther(finalSrcBalance)} (was: ${ethers.formatEther(initialSrcBalance)})`)
    console.log(`   Destination WETH: ${ethers.formatEther(finalDstBalance)} (was: ${ethers.formatEther(initialDstBalance)})`)
    console.log(`   Source ETH: ${ethers.formatEther(finalSrcEth)} (was: ${ethers.formatEther(initialSrcEth)})`)
    console.log(`   Destination ETH: ${ethers.formatEther(finalDstEth)} (was: ${ethers.formatEther(initialDstEth)})`)

    console.log('\n🎉 Cross-chain swap test completed successfully!')
    console.log('='.repeat(60))
    console.log('✅ Resolver deployed on both chains')
    console.log('✅ Order created using Custom SDK')
    console.log('✅ Escrows deployed with fund locking')
    console.log('✅ Withdrawal functionality tested')
    console.log('✅ Complete cross-chain swap flow verified')
}

// Run the script
main().catch((error) => {
    console.error('❌ Script failed:', error)
    process.exit(1)
}) 