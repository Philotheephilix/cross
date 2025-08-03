#!/usr/bin/env node

import 'dotenv/config'
import { ethers } from 'ethers'
import { CustomSDK as Sdk } from '../tests/custom-sdk.js'
import { config } from '../tests/config.js'
import { uint8ArrayToHex, randomBytes, UINT_40_MAX } from '../tests/utils.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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

// Escrow ABI for withdrawal
const ESCROW_ABI = [
    'function withdraw(bytes32 secret, tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external',
    'function cancel(tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external'
]

async function main() {
    console.log('🚀 Starting Simplified Multiple Fill Cross-Chain Swap')
    console.log('='.repeat(60))
    
    // Validate environment variables
    if (!process.env.PRIVATE_KEY || !process.env.SRC_CHAIN_RPC || !process.env.DST_CHAIN_RPC) {
        console.error('❌ Missing required environment variables')
        process.exit(1)
    }

    const srcProvider = new ethers.JsonRpcProvider(process.env.SRC_CHAIN_RPC)
    const dstProvider = new ethers.JsonRpcProvider(process.env.DST_CHAIN_RPC)
    
    const srcChain = await setupChain(config.chain.destination, process.env.PRIVATE_KEY, 'Source (Arbitrum Sepolia)', srcProvider)
    const dstChain = await setupChain(config.chain.source, process.env.PRIVATE_KEY, 'Destination (Sepolia)', dstProvider)

    await performSimplifiedMultipleFillSwap(srcChain, dstChain)
}

async function setupChain(chainConfig, privateKey, chainName, provider) {
    console.log(`🔧 Setting up ${chainName}...`)
    
    const user = new ethers.Wallet(privateKey, provider)
    console.log(`   User address: ${user.address}`)
    
    const ethBalance = await provider.getBalance(user.address)
    console.log(`   ETH balance: ${ethers.formatEther(ethBalance)}`)
    
    // Deploy contracts
    const deployed = await deployContracts(provider, user, chainConfig)
    
    const token = new ethers.Contract(chainConfig.tokens.USDC.address, ERC20_ABI, user)
    const escrowFactoryContract = new ethers.Contract(deployed.escrowFactory, ESCROW_FACTORY_ABI, user)
    
    return {
        provider,
        user,
        token,
        escrowFactory: deployed.escrowFactory,
        resolver: deployed.resolver,
        escrowFactoryContract
    }
}

async function deployContracts(provider, deployer, chainConfig) {
    // Deploy EscrowFactory
    const factoryFactory = new ethers.ContractFactory(
        factoryContract.abi,
        factoryContract.bytecode,
        deployer
    )
    
    const escrowFactory = await factoryFactory.deploy(
        '0x111111125421ca6dc452d289314280a0f8842a65',
        chainConfig.tokens.USDC.address,
        '0x111111125421ca6dc452d289314280a0f8842a65',
        deployer.address,
        3600,
        3600
    )
    await escrowFactory.waitForDeployment()

    // Deploy Resolver
    const resolverFactory = new ethers.ContractFactory(
        resolverContractArtifact.abi,
        resolverContractArtifact.bytecode,
        deployer
    )
    
    const resolver = await resolverFactory.deploy(
        await escrowFactory.getAddress(),
        '0x111111125421ca6dc452d289314280a0f8842a65',
        deployer.address
    )
    await resolver.waitForDeployment()

    return {
        escrowFactory: await escrowFactory.getAddress(),
        resolver: await resolver.getAddress()
    }
}

async function performSimplifiedMultipleFillSwap(srcChain, dstChain) {
    console.log('🔄 Performing Simplified Multiple Fill Swap')
    console.log('='.repeat(50))

    const swapAmount = ethers.parseUnits('0.1', 6) // 0.1 USDC
    const safetyDeposit = ethers.parseEther('0.001') // 0.001 ETH

    // Get initial balances
    const initialSrcBalance = await srcChain.token.balanceOf(srcChain.user.address)
    const initialDstBalance = await dstChain.token.balanceOf(dstChain.user.address)

    console.log('📊 Initial Balances:')
    console.log(`   Source USDC: ${ethers.formatUnits(initialSrcBalance, 6)}`)
    console.log(`   Destination USDC: ${ethers.formatUnits(initialDstBalance, 6)}`)

    // STEP 1: Create multiple fill order with 11 secrets
    console.log('\n📝 Step 1: Creating multiple fill order...')
    
    // Generate 11 secrets for multiple fills
    const secrets = Array.from({length: 11}).map(() => uint8ArrayToHex(randomBytes(32)))
    const secretHashes = secrets.map((s) => Sdk.HashLock.hashSecret(s))
    const leaves = Sdk.HashLock.getMerkleLeaves(secrets)
    
    console.log(`   🔐 Generated ${secrets.length} secrets for multiple fills`)
    
    // Create Fusion+ order with multiple fill support
    const order = Sdk.CrossChainOrder.new(
        srcChain.escrowFactory,
        {
            salt: Sdk.randBigInt(1000n),
            nonce: Sdk.randBigInt(UINT_40_MAX),
            maker: srcChain.user.address,
            makingAmount: swapAmount,
            takingAmount: ethers.parseUnits('0.099', 6), // Slightly less for fees
            makerAsset: config.chain.destination.tokens.USDC.address,
            takerAsset: config.chain.source.tokens.USDC.address
        },
        {
            hashLock: Sdk.HashLock.forMultipleFills(leaves),
            timeLocks: Sdk.TimeLocks.new({
                srcWithdrawal: 10n,
                srcPublicWithdrawal: 120n,
                srcCancellation: 121n,
                srcPublicCancellation: 122n,
                dstWithdrawal: 10n,
                dstPublicWithdrawal: 100n,
                dstCancellation: 101n
            }),
            srcChainId: config.chain.destination.chainId,
            dstChainId: config.chain.source.chainId,
            srcSafetyDeposit: safetyDeposit,
            dstSafetyDeposit: safetyDeposit
        },
        {
            auction: new Sdk.AuctionDetails({
                initialRateBump: 0,
                points: [],
                duration: 120n,
                startTime: BigInt(Math.floor(Date.now() / 1000))
            }),
            whitelist: [
                {
                    address: srcChain.resolver,
                    allowFrom: 0n
                }
            ],
            resolvingStartTime: 0n
        },
        {
            allowPartialFills: true,
            allowMultipleFills: true
        }
    )

    const orderHash = order.getOrderHash(config.chain.destination.chainId)
    console.log(`   Order hash: ${orderHash}`)
    console.log(`   Multiple fills enabled: ✅`)

    // Create signature
    const orderData = ethers.solidityPacked(
        ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
        [
            orderHash,
            order.orderParams.maker,
            order.orderParams.takerAsset,
            order.orderParams.makingAmount,
            order.orderParams.takingAmount,
            Math.floor(Date.now() / 1000)
        ]
    )
    
    const orderSignature = await srcChain.user.signMessage(ethers.getBytes(orderData))
    console.log(`   Order signature: ${orderSignature}`)

    // STEP 2: Choose specific fill and secret
    console.log('\n🏆 Step 2: Choosing specific fill...')
    
    const fillAmount = swapAmount // Full fill
    const idx = secrets.length - 1 // Use last secret
    const selectedSecret = secrets[idx]
    const selectedSecretHash = secretHashes[idx]
    
    console.log(`   Fill amount: ${ethers.formatUnits(fillAmount, 6)} USDC`)
    console.log(`   Secret index: ${idx}`)
    console.log(`   Selected secret: ${selectedSecret}`)
    console.log(`   Selected secret hash: ${selectedSecretHash}`)

    // STEP 3: Create escrow immutables (same as single fill)
    console.log('\n🏗️ Step 3: Creating escrow immutables...')
    
    const srcImmutablesRaw = order.toSrcImmutables(
        config.chain.destination.chainId,
        srcChain.user.address,
        fillAmount,
        selectedSecretHash // Use specific secret hash
    )

    const currentTimestamp = Math.floor(Date.now() / 1000)
    const timelocksWithDeployedAt = (srcImmutablesRaw.timelocks & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00000000n) | BigInt(currentTimestamp)
    
    const srcImmutables = {
        orderHash: srcImmutablesRaw.orderHash,
        hashlock: srcImmutablesRaw.hashlock,
        maker: BigInt(srcImmutablesRaw.maker),
        taker: BigInt(srcImmutablesRaw.taker),
        token: BigInt(srcImmutablesRaw.token),
        amount: srcImmutablesRaw.amount,
        safetyDeposit: safetyDeposit,
        timelocks: timelocksWithDeployedAt
    }

    const dstImmutables = {
        orderHash: srcImmutables.orderHash,
        hashlock: srcImmutables.hashlock,
        maker: srcImmutables.maker,
        taker: BigInt(dstChain.user.address),
        token: BigInt(config.chain.source.tokens.USDC.address),
        amount: fillAmount,
        safetyDeposit: safetyDeposit,
        timelocks: timelocksWithDeployedAt
    }

    // STEP 4: Deploy escrows (same as single fill)
    console.log('\n🔒 Step 4: Deploying escrows...')
    
    // Approve and create source escrow
    console.log('   Approving USDC for source escrow...')
    await srcChain.token.approve(srcChain.escrowFactory, fillAmount, { gasLimit: 100000n })
    
    console.log('   Creating source escrow...')
    console.log(`   srcImmutables:`, JSON.stringify(srcImmutables, null, 2))
    
    const createSrcEscrowTx = await srcChain.escrowFactoryContract.createSrcEscrow(
        srcImmutables,
        { value: safetyDeposit, gasLimit: 300000n }
    )
    console.log(`   Source escrow tx hash: ${createSrcEscrowTx.hash}`)
    const srcReceipt = await createSrcEscrowTx.wait()
    
    console.log(`   Source escrow tx status: ${srcReceipt.status}`)
    console.log(`   Source escrow logs count: ${srcReceipt.logs.length}`)
    
    // Get source escrow address
    let srcEscrowAddress = null
    for (const log of srcReceipt.logs) {
        console.log(`   Log topics: ${log.topics.join(', ')}`)
        try {
            const parsed = srcChain.escrowFactoryContract.interface.parseLog(log)
            console.log(`   Parsed event: ${parsed.name}`)
            if (parsed.name === 'SrcEscrowCreatedDirect') {
                srcEscrowAddress = parsed.args.escrow
                console.log(`   Found SrcEscrowCreatedDirect: ${srcEscrowAddress}`)
                break
            } else if (parsed.name === 'SrcEscrowCreated') {
                console.log(`   Found SrcEscrowCreated event`)
                // For this event, we need to compute the escrow address deterministically
                const srcImmutablesForAddress = {
                    orderHash: parsed.args.srcImmutables.orderHash,
                    hashlock: parsed.args.srcImmutables.hashlock,
                    maker: parsed.args.srcImmutables.maker,
                    taker: parsed.args.srcImmutables.taker,
                    token: parsed.args.srcImmutables.token,
                    amount: parsed.args.srcImmutables.amount,
                    safetyDeposit: parsed.args.srcImmutables.safetyDeposit,
                    timelocks: parsed.args.srcImmutables.timelocks
                }
                srcEscrowAddress = await srcChain.escrowFactoryContract.addressOfEscrowSrc(srcImmutablesForAddress)
                console.log(`   Computed escrow address: ${srcEscrowAddress}`)
                break
            }
        } catch (e) {
            console.log(`   Could not parse log: ${e.message}`)
        }
    }
    
    if (!srcEscrowAddress) {
        console.log('   ❌ Available events in logs:')
        for (const log of srcReceipt.logs) {
            console.log(`     - Topics: ${log.topics.join(', ')}`)
            console.log(`     - Data: ${log.data}`)
        }
        throw new Error('Failed to get source escrow address from transaction logs')
    }
    console.log(`   Source escrow: ${srcEscrowAddress}`)

    // Approve and create destination escrow
    console.log('   Approving USDC for destination escrow...')
    await dstChain.token.approve(dstChain.escrowFactory, fillAmount, { gasLimit: 100000n })
    
    console.log('   Creating destination escrow...')
    console.log(`   dstImmutables:`, JSON.stringify(dstImmutables, null, 2))
    
    const createDstEscrowTx = await dstChain.escrowFactoryContract.createDstEscrow(
        dstImmutables,
        Math.floor(Date.now() / 1000) + 3600,
        { value: safetyDeposit, gasLimit: 300000n }
    )
    console.log(`   Destination escrow tx hash: ${createDstEscrowTx.hash}`)
    const dstReceipt = await createDstEscrowTx.wait()
    
    console.log(`   Destination escrow tx status: ${dstReceipt.status}`)
    console.log(`   Destination escrow logs count: ${dstReceipt.logs.length}`)
    
    // Get destination escrow address
    let dstEscrowAddress = null
    for (const log of dstReceipt.logs) {
        console.log(`   Log topics: ${log.topics.join(', ')}`)
        try {
            const parsed = dstChain.escrowFactoryContract.interface.parseLog(log)
            console.log(`   Parsed event: ${parsed.name}`)
            if (parsed.name === 'DstEscrowCreated') {
                dstEscrowAddress = parsed.args.escrow
                console.log(`   Found DstEscrowCreated: ${dstEscrowAddress}`)
                break
            }
        } catch (e) {
            console.log(`   Could not parse log: ${e.message}`)
        }
    }
    
    if (!dstEscrowAddress) {
        console.log('   ❌ Available events in logs:')
        for (const log of dstReceipt.logs) {
            console.log(`     - Topics: ${log.topics.join(', ')}`)
            console.log(`     - Data: ${log.data}`)
        }
        throw new Error('Failed to get destination escrow address from transaction logs')
    }
    console.log(`   Destination escrow: ${dstEscrowAddress}`)

    // STEP 5: Withdraw (same as single fill)
    console.log('\n🔐 Step 5: Withdrawing...')
    
    // Wait for finality lock
    console.log('   ⏰ Waiting for finality lock (11 seconds)...')
    await new Promise(resolve => setTimeout(resolve, 11000))
    
    // Withdraw from destination escrow
    console.log('   📤 Withdrawing from destination escrow...')
    const dstEscrowContract = new ethers.Contract(dstEscrowAddress, ESCROW_ABI, dstChain.user)
    
    // Get actual deployment timestamp for destination
    const dstBlock = await dstChain.provider.getBlock(dstReceipt.blockNumber)
    const dstDeployedAt = dstBlock.timestamp
    const dstImmutablesWithDeployedAt = {
        ...dstImmutables,
        timelocks: (dstImmutables.timelocks & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00000000n) | BigInt(dstDeployedAt)
    }
    
    const withdrawDstTx = await dstEscrowContract.withdraw(selectedSecret, dstImmutablesWithDeployedAt, {
        gasLimit: 200000n
    })
    await withdrawDstTx.wait()
    console.log('   ✅ Destination withdrawal successful')

    // Withdraw from source escrow
    console.log('   📤 Withdrawing from source escrow...')
    const srcEscrowContract = new ethers.Contract(srcEscrowAddress, ESCROW_ABI, srcChain.user)
    
    const withdrawSrcTx = await srcEscrowContract.withdraw(selectedSecret, srcImmutables, {
        gasLimit: 200000n
    })
    await withdrawSrcTx.wait()
    console.log('   ✅ Source withdrawal successful')

    // Final verification
    console.log('\n📊 Final verification...')
    const finalSrcBalance = await srcChain.token.balanceOf(srcChain.user.address)
    const finalDstBalance = await dstChain.token.balanceOf(dstChain.user.address)
    const finalSrcEscrowBalance = await srcChain.token.balanceOf(srcEscrowAddress)
    const finalDstEscrowBalance = await dstChain.token.balanceOf(dstEscrowAddress)

    console.log(`   Final source balance: ${ethers.formatUnits(finalSrcBalance, 6)} USDC`)
    console.log(`   Final destination balance: ${ethers.formatUnits(finalDstBalance, 6)} USDC`)
    console.log(`   Final source escrow USDC: ${ethers.formatUnits(finalSrcEscrowBalance, 6)}`)
    console.log(`   Final destination escrow USDC: ${ethers.formatUnits(finalDstEscrowBalance, 6)}`)

    console.log('\n🎉 Simplified Multiple Fill Cross-Chain Swap completed!')
    console.log(`📋 Summary:`)
    console.log(`   Order Hash: ${orderHash}`)
    console.log(`   Selected Secret (index ${idx}): ${selectedSecret}`)
    console.log(`   Source Escrow: ${srcEscrowAddress}`)
    console.log(`   Destination Escrow: ${dstEscrowAddress}`)
    console.log(`   Fill Amount: ${ethers.formatUnits(fillAmount, 6)} USDC`)
    console.log(`   Source Balance Change: ${ethers.formatUnits(finalSrcBalance - initialSrcBalance, 6)} USDC`)
    console.log(`   Destination Balance Change: ${ethers.formatUnits(finalDstBalance - initialDstBalance, 6)} USDC`)
    
    if (finalSrcEscrowBalance === 0n && finalDstEscrowBalance === 0n) {
        console.log('\n✅ All funds successfully withdrawn!')
    } else {
        console.log('\n⚠️  Some funds may still be locked')
    }
}

main().catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
}) 