#!/usr/bin/env node

import 'dotenv/config'
import { ethers } from 'ethers'
import { CustomSDK as Sdk } from '../tests/custom-sdk.js'
import { config } from '../tests/config.js'
import { uint8ArrayToHex, randomBytes, UINT_40_MAX } from '../tests/utils.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import readline from 'readline'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Helper function to prompt user for input
function promptUser(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })
    
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close()
            resolve(answer.trim())
        })
    })
}

// Load the BYPASSED contract artifacts
const factoryContract = JSON.parse(readFileSync(join(__dirname, '../dist/contracts/EscrowFactory.sol/EscrowFactory.json'), 'utf8'))
const resolverContractArtifact = JSON.parse(readFileSync(join(__dirname, '../dist/contracts/Resolver.sol/Resolver.json'), 'utf8'))

// ERC20 ABI for token interactions
const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)'
]

// EscrowFactory ABI for proper interactions
const ESCROW_FACTORY_ABI = [
    'function createDstEscrow(tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) dstImmutables, uint256 srcCancellationTimestamp) external payable',
    'function addressOfEscrowSrc(tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external view returns (address)',
    'function createSrcEscrow(tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) srcImmutables) external payable returns (address escrow)',
    'function withdraw(address escrowAddress, bytes32 secret, tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external',
    'function cancel(address escrowAddress, tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external',
    'event SrcEscrowCreatedDirect(address escrow, bytes32 hashlock, address maker)',
    'event SrcEscrowCreated(tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) srcImmutables, tuple(uint256 maker, uint256 amount, uint256 token, uint256 safetyDeposit, uint256 chainId) dstImmutablesComplement)',
    'event DstEscrowCreated(address escrow, bytes32 hashlock, uint256 taker)',
    'function addressOfEscrowDst(tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external view returns (address)'
]

// Escrow ABI for direct withdrawal
const ESCROW_ABI = [
    'function withdraw(bytes32 secret, tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external',
    'function cancel(tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external'
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

// Test RPC connection
async function testRpcConnection(provider, chainName) {
    try {
        console.log(`   Testing ${chainName} RPC connection...`)
        const blockNumber = await provider.getBlockNumber()
        console.log(`   ✅ ${chainName} RPC connected (block ${blockNumber})`)
        return true
    } catch (error) {
        console.log(`   ❌ ${chainName} RPC connection failed: ${error.message}`)
        return false
    }
}

async function main() {
    console.log('🚀 Cross-Chain Swap with BYPASSED Validation')
    console.log('='.repeat(60))
    console.log('🔓 ALL SECURITY CHECKS ARE BYPASSED!')
    console.log('🔓 Secret validation, time restrictions, and caller validation are disabled!')
    console.log('🔓 This is for testing purposes only!')
    console.log('='.repeat(60))

    if (!process.env.PRIVATE_KEY) {
        console.error('❌ PRIVATE_KEY environment variable is required')
        process.exit(1)
    }

    if (!process.env.SRC_CHAIN_RPC || !process.env.DST_CHAIN_RPC) {
        console.error('❌ SRC_CHAIN_RPC and DST_CHAIN_RPC environment variables are required')
        process.exit(1)
    }

    // Test RPC connections
    const srcProvider = new ethers.JsonRpcProvider(process.env.SRC_CHAIN_RPC)
    const dstProvider = new ethers.JsonRpcProvider(process.env.DST_CHAIN_RPC)

    console.log('\n🔗 Testing RPC Connections...')
    const srcRpcOk = await testRpcConnection(srcProvider, 'Source Chain')
    const dstRpcOk = await testRpcConnection(dstProvider, 'Destination Chain')

    if (!srcRpcOk || !dstRpcOk) {
        console.error('❌ RPC connection test failed')
        process.exit(1)
    }

    // Setup chains with bypassed contracts
    console.log('\n🔧 Setting up chains with BYPASSED contracts...')
    
    const srcChain = await setupChain(config.chain.source, process.env.PRIVATE_KEY, 'Source', srcProvider)
    const dstChain = await setupChain(config.chain.destination, process.env.PRIVATE_KEY, 'Destination', dstProvider)

    // Deploy bypassed contracts
    console.log('\n🏗️ Deploying BYPASSED contracts...')
    await deployContracts(srcProvider, srcChain.user, config.chain.source)
    await deployContracts(dstProvider, dstChain.user, config.chain.destination)

    // Perform the cross-chain swap with bypassed validation
    await performBypassedCrossChainSwap(srcChain, dstChain)
}

async function setupChain(chainConfig, privateKey, chainName, provider) {
    console.log(`   Setting up ${chainName} chain...`)
    
    const user = new ethers.Wallet(privateKey, provider)
    console.log(`   User address: ${user.address}`)

    // Create token contracts
    const token = new ethers.Contract(chainConfig.tokens.USDC.address, ERC20_ABI, user)
    
    // Create factory contract (will be deployed later)
    const escrowFactoryContract = null // Will be set after deployment
    
    return {
        provider,
        user,
        token,
        escrowFactoryContract,
        escrowFactory: '', // Will be set after deployment
        resolver: '', // Will be set after deployment
        chainConfig
    }
}

async function deployContracts(provider, deployer, chainConfig) {
    console.log(`   Deploying contracts on ${chainConfig.name}...`)
    
    // Deploy EscrowFactory with bypassed validation
    const escrowFactoryFactory = new ethers.ContractFactory(
        factoryContract.abi,
        factoryContract.bytecode,
        deployer
    )
    
    const escrowFactory = await escrowFactoryFactory.deploy(
        '0x111111125421ca6dc452d289314280a0f8842a65', // limitOrderProtocol
        chainConfig.tokens.USDC.address, // feeToken (USDC)
        '0x111111125421ca6dc452d289314280a0f8842a65', // accessToken
        deployer.address, // owner
        300, // rescueDelaySrc
        300  // rescueDelayDst
    )
    await escrowFactory.waitForDeployment()
    const escrowFactoryAddress = await escrowFactory.getAddress()
    console.log(`   ✅ EscrowFactory deployed: ${escrowFactoryAddress}`)

    // Deploy Resolver
    const resolverFactory = new ethers.ContractFactory(
        resolverContractArtifact.abi,
        resolverContractArtifact.bytecode,
        deployer
    )
    
    const resolver = await resolverFactory.deploy(
        escrowFactoryAddress, // factory
        '0x111111125421ca6dc452d289314280a0f8842a65', // lop
        deployer.address // initialOwner
    )
    await resolver.waitForDeployment()
    const resolverAddress = await resolver.getAddress()
    console.log(`   ✅ Resolver deployed: ${resolverAddress}`)

    // Update chain config
    chainConfig.escrowFactory = escrowFactoryAddress
    chainConfig.resolver = resolverAddress

    return { escrowFactory, resolver }
}

async function performBypassedCrossChainSwap(srcChain, dstChain) {
    console.log('\n🔄 Performing Cross-Chain Swap with BYPASSED Validation')
    console.log('='.repeat(60))

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

    // Generate fake secret and hashlock for bypassed validation
    const fakeSecret = '0x0000000000000000000000000000000000000000000000000000000000000001'
    const fakeHashlock = ethers.keccak256(fakeSecret)
    
    console.log('\n🔐 BYPASSED Validation Setup:')
    console.log(`   🔓 Using FAKE secret: ${fakeSecret}`)
    console.log(`   🔓 Using FAKE hashlock: ${fakeHashlock}`)
    console.log(`   🔓 All validation checks are bypassed!`)

    // Create simple immutables for bypassed testing
    const orderHash = ethers.keccak256(ethers.toUtf8Bytes('bypassed-order-' + Date.now()))
    const maker = BigInt(srcChain.user.address)
    const taker = BigInt(dstChain.user.address)
    const timelocks = 0n // All stages start immediately

    const srcImmutables = {
        orderHash: orderHash,
        hashlock: fakeHashlock,
        maker: maker,
        taker: taker,
        token: BigInt(await srcChain.token.getAddress()),
        amount: swapAmount,
        safetyDeposit: safetyDeposit,
        timelocks: timelocks
    }

    const dstImmutables = {
        orderHash: orderHash,
        hashlock: fakeHashlock,
        maker: maker,
        taker: taker,
        token: BigInt(await dstChain.token.getAddress()),
        amount: swapAmount,
        safetyDeposit: safetyDeposit,
        timelocks: timelocks
    }

    console.log('\n📋 BYPASSED Order Details:')
    console.log(`   Order Hash: ${orderHash}`)
    console.log(`   Amount: ${ethers.formatUnits(swapAmount, 6)} USDC`)
    console.log(`   Safety Deposit: ${ethers.formatEther(safetyDeposit)} ETH`)
    console.log(`   Timelock: All stages start immediately (bypassed)`)

    // STEP 1: Lock funds in source escrow
    console.log('\n🔒 STEP 1: Locking funds in source escrow (BYPASSED)...')
    
    // Approve tokens
    console.log('   Approving USDC for source factory...')
    const approveSrcTx = await srcChain.token.approve(srcChain.chainConfig.escrowFactory, swapAmount)
    await approveSrcTx.wait()
    console.log('   ✅ Source USDC approved')

    // Create source escrow
    console.log('   Creating source escrow...')
    const srcFactoryContract = new ethers.Contract(srcChain.chainConfig.escrowFactory, ESCROW_FACTORY_ABI, srcChain.user)
    
    const createSrcTx = await srcFactoryContract.createSrcEscrow(srcImmutables, {
        value: safetyDeposit
    })
    const srcReceipt = await createSrcTx.wait()
    console.log('   ✅ Source escrow created')

    // Extract escrow address from transfer event
    let srcEscrowAddress = null
    for (const log of srcReceipt.logs) {
        if (log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
            srcEscrowAddress = '0x' + log.topics[2].slice(26)
            break
        }
    }
    console.log(`   Source escrow address: ${srcEscrowAddress}`)

    // STEP 2: Lock funds in destination escrow
    console.log('\n🔒 STEP 2: Locking funds in destination escrow (BYPASSED)...')
    
    // Approve tokens
    console.log('   Approving USDC for destination factory...')
    const approveDstTx = await dstChain.token.approve(dstChain.chainConfig.escrowFactory, swapAmount)
    await approveDstTx.wait()
    console.log('   ✅ Destination USDC approved')

    // Create destination escrow
    console.log('   Creating destination escrow...')
    const dstFactoryContract = new ethers.Contract(dstChain.chainConfig.escrowFactory, ESCROW_FACTORY_ABI, dstChain.user)
    
    const createDstTx = await dstFactoryContract.createDstEscrow(dstImmutables, Math.floor(Date.now() / 1000) + 300, {
        value: safetyDeposit
    })
    const dstReceipt = await createDstTx.wait()
    console.log('   ✅ Destination escrow created')

    // Extract escrow address from transfer event
    let dstEscrowAddress = null
    for (const log of dstReceipt.logs) {
        if (log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
            dstEscrowAddress = '0x' + log.topics[2].slice(26)
            break
        }
    }
    console.log(`   Destination escrow address: ${dstEscrowAddress}`)

    // Check escrow balances
    const srcEscrowBalance = await srcChain.token.balanceOf(srcEscrowAddress)
    const dstEscrowBalance = await dstChain.token.balanceOf(dstEscrowAddress)
    const srcEscrowEth = await srcChain.provider.getBalance(srcEscrowAddress)
    const dstEscrowEth = await dstChain.provider.getBalance(dstEscrowAddress)

    console.log('\n📊 Escrow Balances After Lock:')
    console.log(`   Source escrow USDC: ${ethers.formatUnits(srcEscrowBalance, 6)}`)
    console.log(`   Destination escrow USDC: ${ethers.formatUnits(dstEscrowBalance, 6)}`)
    console.log(`   Source escrow ETH: ${ethers.formatEther(srcEscrowEth)}`)
    console.log(`   Destination escrow ETH: ${ethers.formatEther(dstEscrowEth)}`)

    // STEP 3: Withdraw with bypassed validation
    console.log('\n🔓 STEP 3: Withdrawing with BYPASSED validation...')
    console.log(`   🔓 Using FAKE secret: ${fakeSecret}`)
    console.log(`   🔓 All validation checks are bypassed!`)

    // Withdraw from source escrow
    console.log('\n📤 Withdrawing from source escrow...')
    try {
        const srcEscrowContract = new ethers.Contract(srcEscrowAddress, ESCROW_ABI, srcChain.user)
        const srcWithdrawTx = await srcEscrowContract.withdraw(fakeSecret, srcImmutables)
        await srcWithdrawTx.wait()
        console.log('   ✅ Source escrow withdrawal successful!')
    } catch (error) {
        console.log(`   ❌ Source withdrawal failed: ${error.message}`)
    }

    // Withdraw from destination escrow
    console.log('\n📤 Withdrawing from destination escrow...')
    try {
        const dstEscrowContract = new ethers.Contract(dstEscrowAddress, ESCROW_ABI, dstChain.user)
        const dstWithdrawTx = await dstEscrowContract.withdraw(fakeSecret, dstImmutables)
        await dstWithdrawTx.wait()
        console.log('   ✅ Destination escrow withdrawal successful!')
    } catch (error) {
        console.log(`   ❌ Destination withdrawal failed: ${error.message}`)
    }

    // Check final balances
    console.log('\n📊 Final Balances:')
    const finalSrcBalance = await srcChain.token.balanceOf(srcChain.user.address)
    const finalDstBalance = await dstChain.token.balanceOf(dstChain.user.address)
    const finalSrcEth = await srcChain.provider.getBalance(srcChain.user.address)
    const finalDstEth = await dstChain.provider.getBalance(dstChain.user.address)

    console.log(`   Source USDC: ${ethers.formatUnits(finalSrcBalance, 6)}`)
    console.log(`   Destination USDC: ${ethers.formatUnits(finalDstBalance, 6)}`)
    console.log(`   Source ETH: ${ethers.formatEther(finalSrcEth)}`)
    console.log(`   Destination ETH: ${ethers.formatEther(finalDstEth)}`)

    // Calculate gains/losses
    const srcUsdcGain = finalSrcBalance - initialSrcBalance
    const dstUsdcGain = finalDstBalance - initialDstBalance
    const srcEthGain = finalSrcEth - initialSrcEth
    const dstEthGain = finalDstEth - initialDstEth

    console.log('\n💰 Transaction Summary:')
    console.log(`   Source USDC change: ${ethers.formatUnits(srcUsdcGain, 6)}`)
    console.log(`   Destination USDC change: ${ethers.formatUnits(dstUsdcGain, 6)}`)
    console.log(`   Source ETH change: ${ethers.formatEther(srcEthGain)}`)
    console.log(`   Destination ETH change: ${ethers.formatEther(dstEthGain)}`)

    if (srcUsdcGain >= 0n && dstUsdcGain >= 0n) {
        console.log('\n✅ SUCCESS: Cross-chain swap completed with BYPASSED validation!')
        console.log('🔓 All security checks were successfully bypassed!')
    } else {
        console.log('\n⚠️  Some funds may still be locked')
    }

    console.log('\n🎯 BYPASSED cross-chain swap test completed!')
    console.log('💡 This demonstrates the complete flow with all validation checks bypassed.')
}

main().catch(console.error)