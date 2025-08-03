#!/usr/bin/env node

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { ethers } from 'ethers'
import { CustomSDK as Sdk } from './tests/custom-sdk.js'
import { config } from './tests/config.js'
import { uint8ArrayToHex, randomBytes, UINT_40_MAX } from './tests/utils.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// Load contract artifacts
const factoryContract = JSON.parse(readFileSync(join(__dirname, 'dist/contracts/EscrowFactory.sol/EscrowFactory.json'), 'utf8'))
const resolverContractArtifact = JSON.parse(readFileSync(join(__dirname, 'dist/contracts/Resolver.sol/Resolver.json'), 'utf8'))

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

// Store active swaps
const activeSwaps = new Map()

// Setup providers
const srcProvider = new ethers.JsonRpcProvider(process.env.SRC_CHAIN_RPC)
const dstProvider = new ethers.JsonRpcProvider(process.env.DST_CHAIN_RPC)

// Setup relayer wallets
const srcRelayer = new ethers.Wallet(process.env.PRIVATE_KEY, srcProvider)
const dstRelayer = new ethers.Wallet(process.env.PRIVATE_KEY, dstProvider)

// Deploy contracts function
async function deployContracts(provider, deployer, chainConfig) {
    try {
        // Deploy EscrowFactory
        const factoryFactory = new ethers.ContractFactory(
            factoryContract.abi,
            factoryContract.bytecode,
            deployer
        )
        
        console.log('   Deploying EscrowFactory...')
        const escrowFactory = await factoryFactory.deploy(
            chainConfig.limitOrderProtocol,
            chainConfig.tokens.USDC.address,
            chainConfig.limitOrderProtocol,
            deployer.address,
            3600, // rescueDelaySrc
            3600  // rescueDelayDst
        )
        await escrowFactory.waitForDeployment()
        console.log(`   EscrowFactory deployed: ${await escrowFactory.getAddress()}`)

        // Deploy Resolver
        const resolverFactory = new ethers.ContractFactory(
            resolverContractArtifact.abi,
            resolverContractArtifact.bytecode,
            deployer
        )
        
        console.log('   Deploying Resolver...')
        const resolver = await resolverFactory.deploy(
            await escrowFactory.getAddress(),
            chainConfig.limitOrderProtocol,
            deployer.address
        )
        await resolver.waitForDeployment()
        console.log(`   Resolver deployed: ${await resolver.getAddress()}`)

        return {
            escrowFactory: await escrowFactory.getAddress(),
            resolver: await resolver.getAddress()
        }
    } catch (error) {
        console.log(`   ❌ Contract deployment failed: ${error.message}`)
        throw error
    }
}

// API Routes

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() })
})

// Deploy factory contracts
app.post('/api/deploy-factories', async (req, res) => {
    try {
        console.log('🚀 Deploying factory contracts for cross-chain swap...')

        // Deploy on source chain (Sepolia)
        console.log('Deploying on Sepolia (source)...')
        const srcDeployed = await deployContracts(srcProvider, srcRelayer, config.chain.source)
        
        // Deploy on destination chain (Arbitrum Sepolia)
        console.log('Deploying on Arbitrum Sepolia (destination)...')
        const dstDeployed = await deployContracts(dstProvider, dstRelayer, config.chain.destination)

        const deploymentInfo = {
            sepolia: {
                escrowFactory: srcDeployed.escrowFactory,
                resolver: srcDeployed.resolver,
                chainId: config.chain.source.chainId
            },
            arbitrumSepolia: {
                escrowFactory: dstDeployed.escrowFactory,
                resolver: dstDeployed.resolver,
                chainId: config.chain.destination.chainId
            },
            tokens: {
                sepolia: config.chain.source.tokens.USDC.address,
                arbitrumSepolia: config.chain.destination.tokens.USDC.address
            },
            deployedAt: new Date().toISOString()
        }

        res.json({
            success: true,
            deploymentInfo
        })
    } catch (error) {
        console.error('❌ Deployment failed:', error)
        res.status(500).json({
            success: false,
            error: error.message
        })
    }
})

// Create order and get signing data
app.post('/api/create-order', async (req, res) => {
    try {
        const { 
            amount, 
            userAddress, 
            srcFactoryAddress, 
            dstFactoryAddress 
        } = req.body

        console.log(`🔄 Creating order for ${amount} USDC swap from ${userAddress}`)

        // Generate HTLC secret and hashlock
        const secret = uint8ArrayToHex(randomBytes(32))
        const hashlock = ethers.keccak256(secret)
        
        const swapAmount = ethers.parseUnits(amount.toString(), 6)
        const safetyDeposit = ethers.parseEther('0.001')

        // Create Fusion+ order
        const order = Sdk.CrossChainOrder.new(
            srcFactoryAddress,
            {
                salt: Sdk.randBigInt(1000n),
                nonce: Sdk.randBigInt(UINT_40_MAX),
                maker: userAddress,
                makingAmount: swapAmount,
                takingAmount: swapAmount,
                makerAsset: config.chain.source.tokens.USDC.address, // Sepolia USDC
                takerAsset: config.chain.destination.tokens.USDC.address // Arbitrum Sepolia USDC
            },
            {
                allowPartialFills: true,
                allowMultipleFills: false
            }
        )

        const orderHash = order.getOrderHash(config.chain.source.chainId)

        // Create immutables
        const srcImmutablesRaw = order.toSrcImmutables(
            config.chain.destination.chainId,
            userAddress,
            swapAmount,
            hashlock
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
            taker: BigInt(userAddress),
            token: BigInt(config.chain.destination.tokens.USDC.address),
            amount: swapAmount,
            safetyDeposit: safetyDeposit,
            timelocks: timelocksWithDeployedAt
        }

        // Store swap data
        const swapId = orderHash
        activeSwaps.set(swapId, {
            orderHash,
            secret,
            hashlock,
            amount: swapAmount,
            userAddress,
            srcImmutables,
            dstImmutables,
            srcFactoryAddress,
            dstFactoryAddress,
            status: 'created',
            createdAt: new Date().toISOString()
        })

        // Create typed data for message signing
        const typedData = {
            types: {
                EIP712Domain: [
                    { name: 'name', type: 'string' },
                    { name: 'version', type: 'string' },
                    { name: 'chainId', type: 'uint256' },
                    { name: 'verifyingContract', type: 'address' }
                ],
                CrossChainSwapOrder: [
                    { name: 'userAddress', type: 'address' },
                    { name: 'amount', type: 'uint256' },
                    { name: 'srcFactoryAddress', type: 'address' },
                    { name: 'dstFactoryAddress', type: 'address' },
                    { name: 'hashlock', type: 'bytes32' },
                    { name: 'orderHash', type: 'bytes32' },
                    { name: 'timestamp', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' }
                ]
            },
            primaryType: 'CrossChainSwapOrder',
            domain: {
                name: 'Cross-Chain Swap Order',
                version: '1',
                chainId: config.chain.source.chainId,
                verifyingContract: srcFactoryAddress
            },
            message: {
                userAddress: userAddress,
                amount: swapAmount.toString(),
                srcFactoryAddress: srcFactoryAddress,
                dstFactoryAddress: dstFactoryAddress,
                hashlock: hashlock,
                orderHash: orderHash,
                timestamp: currentTimestamp.toString(),
                nonce: Math.floor(Math.random() * 1000000).toString()
            }
        }

        res.json({
            success: true,
            swapId,
            orderHash,
            typedData,
            approvalData: {
                tokenAddress: config.chain.source.tokens.USDC.address,
                spender: srcFactoryAddress,
                amount: swapAmount.toString()
            }
        })
    } catch (error) {
        console.error('❌ Order creation failed:', error)
        res.status(500).json({
            success: false,
            error: error.message
        })
    }
})

// Submit signed message and start swap
app.post('/api/submit-signed-message', async (req, res) => {
    try {
        const { swapId, signature, userAddress } = req.body

        console.log(`📝 Received signed message for swap ${swapId} from ${userAddress}`)

        const swapData = activeSwaps.get(swapId)
        if (!swapData) {
            return res.status(404).json({
                success: false,
                error: 'Swap not found'
            })
        }

        if (swapData.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
            return res.status(403).json({
                success: false,
                error: 'Unauthorized: signature does not match swap user'
            })
        }

        // Verify the signature
        try {
            const typedData = {
                types: {
                    EIP712Domain: [
                        { name: 'name', type: 'string' },
                        { name: 'version', type: 'string' },
                        { name: 'chainId', type: 'uint256' },
                        { name: 'verifyingContract', type: 'address' }
                    ],
                    CrossChainSwapOrder: [
                        { name: 'userAddress', type: 'address' },
                        { name: 'amount', type: 'uint256' },
                        { name: 'srcFactoryAddress', type: 'address' },
                        { name: 'dstFactoryAddress', type: 'address' },
                        { name: 'hashlock', type: 'bytes32' },
                        { name: 'orderHash', type: 'bytes32' },
                        { name: 'timestamp', type: 'uint256' },
                        { name: 'nonce', type: 'uint256' }
                    ]
                },
                primaryType: 'CrossChainSwapOrder',
                domain: {
                    name: 'Cross-Chain Swap Order',
                    version: '1',
                    chainId: config.chain.source.chainId,
                    verifyingContract: swapData.srcFactoryAddress
                },
                message: {
                    userAddress: swapData.userAddress,
                    amount: swapData.amount.toString(),
                    srcFactoryAddress: swapData.srcFactoryAddress,
                    dstFactoryAddress: swapData.dstFactoryAddress,
                    hashlock: swapData.hashlock,
                    orderHash: swapData.orderHash,
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    nonce: Math.floor(Math.random() * 1000000).toString()
                }
            }

            const recoveredAddress = ethers.verifyTypedData(
                typedData.domain,
                { CrossChainSwapOrder: typedData.types.CrossChainSwapOrder },
                typedData.message,
                signature
            )

            if (recoveredAddress.toLowerCase() !== userAddress.toLowerCase()) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid signature'
                })
            }

            console.log(`✅ Signature verified for ${userAddress}`)
        } catch (error) {
            console.error('❌ Signature verification failed:', error)
            return res.status(400).json({
                success: false,
                error: 'Signature verification failed'
            })
        }

        // Update swap data with signature
        swapData.status = 'signature_received'
        swapData.signature = signature
        activeSwaps.set(swapId, swapData)

        // Start swap execution asynchronously
        console.log(`🚀 Starting swap execution for ${swapId}...`)
        executeSwapAsync(swapData)

        res.json({
            success: true,
            message: 'Signed message received and swap started',
            swapId
        })
    } catch (error) {
        console.error('❌ Signed message submission failed:', error)
        res.status(500).json({
            success: false,
            error: error.message
        })
    }
})

// Get swap status
app.get('/api/swap-status/:swapId', (req, res) => {
    const { swapId } = req.params
    const swapData = activeSwaps.get(swapId)
    
    if (!swapData) {
        return res.status(404).json({
            success: false,
            error: 'Swap not found'
        })
    }

    res.json({
        success: true,
        status: swapData.status,
        swapId,
        details: {
            amount: ethers.formatUnits(swapData.amount, 6),
            userAddress: swapData.userAddress,
            createdAt: swapData.createdAt,
            srcEscrowAddress: swapData.srcEscrowAddress || null,
            dstEscrowAddress: swapData.dstEscrowAddress || null
        }
    })
})

// Async swap execution function
async function executeSwapAsync(swapData) {
    try {
        console.log(`🔄 Executing swap for ${swapData.userAddress}...`)

        // Setup contracts
        const srcFactory = new ethers.Contract(swapData.srcFactoryAddress, ESCROW_FACTORY_ABI, srcRelayer)
        const dstFactory = new ethers.Contract(swapData.dstFactoryAddress, ESCROW_FACTORY_ABI, dstRelayer)
        const srcToken = new ethers.Contract(config.chain.source.tokens.USDC.address, ERC20_ABI, srcRelayer)
        const dstToken = new ethers.Contract(config.chain.destination.tokens.USDC.address, ERC20_ABI, dstRelayer)

        // Step 1: Approve tokens on destination chain (relayer)
        console.log('   Relayer: Approving USDC on destination chain...')
        swapData.status = 'approving_dst'
        activeSwaps.set(swapData.orderHash, swapData)

        const dstBalance = await dstToken.balanceOf(dstRelayer.address)
        if (dstBalance < swapData.amount) {
            throw new Error(`Insufficient relayer balance on destination chain: ${ethers.formatUnits(dstBalance, 6)} USDC`)
        }

        const dstApprovalTx = await dstToken.approve(swapData.dstFactoryAddress, swapData.amount)
        await dstApprovalTx.wait()
        console.log('   ✅ Relayer approved USDC on destination chain')

        // Step 2: Create destination escrow
        console.log('   Relayer: Creating destination escrow...')
        swapData.status = 'creating_dst_escrow'
        activeSwaps.set(swapData.orderHash, swapData)

        const srcCancellationTimestamp = Math.floor(Date.now() / 1000) + 3600
        const createDstEscrowTx = await dstFactory.createDstEscrow(
            swapData.dstImmutables,
            srcCancellationTimestamp,
            { value: swapData.dstImmutables.safetyDeposit }
        )
        const dstReceipt = await createDstEscrowTx.wait()

        // Get destination escrow address from events
        let dstEscrowAddress = null
        for (const log of dstReceipt.logs) {
            try {
                const parsed = dstFactory.interface.parseLog(log)
                if (parsed.name === 'DstEscrowCreated') {
                    dstEscrowAddress = parsed.args.escrow
                    break
                }
            } catch (e) {
                // Ignore parsing errors
            }
        }

        if (!dstEscrowAddress) {
            throw new Error('Could not find destination escrow address')
        }

        swapData.dstEscrowAddress = dstEscrowAddress
        console.log(`   ✅ Destination escrow created: ${dstEscrowAddress}`)

        // Step 3: Wait for user approval and create source escrow
        console.log('   Waiting for user approval on source chain...')
        swapData.status = 'waiting_src_approval'
        activeSwaps.set(swapData.orderHash, swapData)

        // Check for user approval (polling mechanism)
        let approved = false
        let attempts = 0
        const maxAttempts = 60 // 5 minutes

        while (!approved && attempts < maxAttempts) {
            try {
                const allowance = await srcToken.allowance(swapData.userAddress, swapData.srcFactoryAddress)
                if (allowance >= swapData.amount) {
                    approved = true
                    console.log('   ✅ User approval detected')
                } else {
                    await new Promise(resolve => setTimeout(resolve, 5000)) // Wait 5 seconds
                    attempts++
                }
            } catch (error) {
                await new Promise(resolve => setTimeout(resolve, 5000))
                attempts++
            }
        }

        if (!approved) {
            throw new Error('User approval timeout')
        }

        // Step 4: Create source escrow (after approval detected)
        console.log('   Relayer: Creating source escrow...')
        swapData.status = 'creating_src_escrow'
        activeSwaps.set(swapData.orderHash, swapData)

        const createSrcEscrowTx = await srcFactory.createSrcEscrow(
            swapData.srcImmutables,
            { value: swapData.srcImmutables.safetyDeposit }
        )
        const srcReceipt = await createSrcEscrowTx.wait()

        // Get source escrow address from events
        let srcEscrowAddress = null
        for (const log of srcReceipt.logs) {
            try {
                const parsed = srcFactory.interface.parseLog(log)
                if (parsed.name === 'SrcEscrowCreatedDirect') {
                    srcEscrowAddress = parsed.args.escrow
                    break
                } else if (parsed.name === 'SrcEscrowCreated') {
                    srcEscrowAddress = await srcFactory.addressOfEscrowSrc(swapData.srcImmutables)
                    break
                }
            } catch (e) {
                // Ignore parsing errors
            }
        }

        if (!srcEscrowAddress) {
            throw new Error('Could not find source escrow address')
        }

        swapData.srcEscrowAddress = srcEscrowAddress
        console.log(`   ✅ Source escrow created: ${srcEscrowAddress}`)

        // Step 5: Wait a bit then execute withdrawals
        console.log('   Waiting for finality...')
        await new Promise(resolve => setTimeout(resolve, 10000)) // Wait 10 seconds

        // Step 6: Withdraw from source escrow (user gets their tokens)
        console.log('   Relayer: Withdrawing from source escrow...')
        swapData.status = 'withdrawing_src'
        activeSwaps.set(swapData.orderHash, swapData)

        const srcEscrowContract = new ethers.Contract(srcEscrowAddress, ESCROW_ABI, srcRelayer)
        const withdrawSrcTx = await srcEscrowContract.withdraw(swapData.secret, swapData.srcImmutables)
        await withdrawSrcTx.wait()
        console.log('   ✅ Relayer withdrew from source escrow (secret revealed)')

        // Step 7: Withdraw from destination escrow (complete the swap)
        console.log('   Relayer: Withdrawing from destination escrow...')
        swapData.status = 'withdrawing_dst'
        activeSwaps.set(swapData.orderHash, swapData)

        const dstEscrowContract = new ethers.Contract(dstEscrowAddress, ESCROW_ABI, dstRelayer)
        const withdrawDstTx = await dstEscrowContract.withdraw(swapData.secret, swapData.dstImmutables)
        await withdrawDstTx.wait()
        console.log('   ✅ Relayer withdrew from destination escrow')

        // Step 8: Transfer destination tokens to user
        console.log('   Relayer: Transferring destination tokens to user...')
        const transferTx = await dstToken.transfer(swapData.userAddress, swapData.amount)
        await transferTx.wait()
        console.log('   ✅ Destination tokens transferred to user')

        swapData.status = 'completed'
        swapData.completedAt = new Date().toISOString()
        activeSwaps.set(swapData.orderHash, swapData)

        console.log(`🎉 Swap completed successfully for ${swapData.userAddress}`)

    } catch (error) {
        console.error(`❌ Swap execution failed: ${error.message}`)
        swapData.status = 'failed'
        swapData.error = error.message
        activeSwaps.set(swapData.orderHash, swapData)
    }
}

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Cross-chain swap relayer server running on port ${PORT}`)
    console.log(`📡 Health check: http://localhost:${PORT}/health`)
    
    // Validate environment variables
    if (!process.env.PRIVATE_KEY || !process.env.SRC_CHAIN_RPC || !process.env.DST_CHAIN_RPC) {
        console.error('❌ Missing required environment variables: PRIVATE_KEY, SRC_CHAIN_RPC, DST_CHAIN_RPC')
        process.exit(1)
    }
    
    console.log('✅ Environment variables validated')
})

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down relayer server...')
    process.exit(0)
}) 