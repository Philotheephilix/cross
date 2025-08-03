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

// Load contract artifacts (same as arb-sep.js)
let factoryContract, resolverContractArtifact

try {
    factoryContract = JSON.parse(readFileSync(join(__dirname, 'dist/contracts/EscrowFactory.sol/EscrowFactory.json'), 'utf8'))
    resolverContractArtifact = JSON.parse(readFileSync(join(__dirname, 'dist/contracts/Resolver.sol/Resolver.json'), 'utf8'))
    console.log('✅ Contract artifacts loaded successfully')
} catch (error) {
    console.error('❌ Failed to load contract artifacts:', error.message)
    console.log('💡 Make sure to compile contracts first: forge build')
    process.exit(1)
}

// ERC20 ABI for token interactions
const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)'
]

// WETH ABI for wrapping/unwrapping ETH
const WETH_ABI = [
    'function deposit() external payable',
    'function withdraw(uint256 amount) external',
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

// Setup providers with ENS disabled for Monad testnet
const srcProvider = new ethers.JsonRpcProvider(process.env.SRC_CHAIN_RPC)
const dstProvider = new ethers.JsonRpcProvider(process.env.DST_CHAIN_RPC, undefined, {
    ensAddress: null // Disable ENS for Monad testnet
})

// Setup relayer wallets
const srcRelayer = new ethers.Wallet(process.env.PRIVATE_KEY, srcProvider)
const dstRelayer = new ethers.Wallet(process.env.PRIVATE_KEY, dstProvider)

// Deploy contracts function
async function deployContracts(provider, deployer, chainConfig, chainName) {
    try {
        // Use EscrowFactory for both chains (same as arb-sep.js)
        const contractToUse = factoryContract
        const factoryName = 'EscrowFactory'
        
        console.log(`   Chain: ${chainName} (${chainConfig.chainId})`)
        console.log(`   Limit Order Protocol: ${chainConfig.limitOrderProtocol}`)
        console.log(`   WETH Address: ${chainConfig.tokens.WETH.address}`)
        console.log(`   Deployer: ${deployer.address}`)
        
        // Deploy EscrowFactory (same as arb-sep.js)
        const factoryFactory = new ethers.ContractFactory(
            contractToUse.abi,
            contractToUse.bytecode,
            deployer
        )
        
        console.log(`   Deploying ${factoryName}...`)
        
        // Ensure all addresses are properly formatted
        const limitOrderProtocol = ethers.getAddress(chainConfig.limitOrderProtocol)
        const wethAddress = ethers.getAddress(chainConfig.tokens.WETH.address)
        const deployerAddress = ethers.getAddress(deployer.address)
        
        const escrowFactory = await factoryFactory.deploy(
            limitOrderProtocol,
            wethAddress, // Use WETH instead of USDC
            limitOrderProtocol,
            deployerAddress,
            3600, // rescueDelaySrc
            3600  // rescueDelayDst
        )
        await escrowFactory.waitForDeployment()
        console.log(`   ${factoryName} deployed: ${await escrowFactory.getAddress()}`)

        // Deploy Resolver
        const resolverFactory = new ethers.ContractFactory(
            resolverContractArtifact.abi,
            resolverContractArtifact.bytecode,
            deployer
        )
        
        console.log('   Deploying Resolver...')
        const resolver = await resolverFactory.deploy(
            await escrowFactory.getAddress(),
            limitOrderProtocol, // Use the formatted address
            deployerAddress // Use the formatted address
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

// Get deployed contract addresses
app.get('/api/contracts', (req, res) => {
    if (!deployedContracts) {
        return res.status(503).json({
            success: false,
            error: 'Contracts not yet deployed'
        })
    }
    
    res.json({
        success: true,
        contracts: deployedContracts,
        relayerAddress: srcRelayer.address // Add relayer address for frontend approval
    })
})

// Deploy factory contracts
app.post('/api/deploy-factories', async (req, res) => {
    try {
        console.log('🚀 Deploying factory contracts for cross-chain swap...')

        // Deploy on source chain (Sepolia)
        console.log('Deploying on Sepolia (source)...')
                    const srcDeployed = await deployContracts(srcProvider, srcRelayer, config.chain.source, 'Sepolia')
        
        // Deploy on destination chain (Monad)
        console.log('Deploying on Monad (destination)...')
        const dstDeployed = await deployContracts(dstProvider, dstRelayer, config.chain.destination, 'Monad')

        const deploymentInfo = {
            sepolia: {
                escrowFactory: srcDeployed.escrowFactory,
                resolver: srcDeployed.resolver,
                chainId: config.chain.source.chainId
            },
            monad: {
                escrowFactory: dstDeployed.escrowFactory,
                resolver: dstDeployed.resolver,
                chainId: config.chain.destination.chainId
            },
            tokens: {
                sepolia: config.chain.source.tokens.WETH.address,
                monad: config.chain.destination.tokens.WETH.address
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

        console.log(`🔄 Creating order for ${amount} WETH swap from ${userAddress}`)

        // Generate HTLC secret and hashlock
        const secret = uint8ArrayToHex(randomBytes(32))
        const hashlock = ethers.keccak256(secret)
        
        const swapAmount = ethers.parseEther(amount.toString()) // WETH uses 18 decimals
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
                makerAsset: config.chain.source.tokens.WETH.address, // Sepolia WETH
                takerAsset: config.chain.destination.tokens.WETH.address // Monad WETH
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
            token: BigInt(config.chain.destination.tokens.WETH.address), // Monad WETH
            amount: swapAmount,
            safetyDeposit: safetyDeposit,
            timelocks: timelocksWithDeployedAt
        }

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
            createdAt: new Date().toISOString(),
            typedData: typedData // Store the original typed data for verification
        })

        res.json({
            success: true,
            swapId,
            orderHash,
            typedData,
            approvalData: {
                tokenAddress: config.chain.source.tokens.WETH.address,
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
            // Use the original typed data that was sent to the frontend
            const originalTypedData = swapData.typedData

            const recoveredAddress = ethers.verifyTypedData(
                originalTypedData.domain,
                { CrossChainSwapOrder: originalTypedData.types.CrossChainSwapOrder },
                originalTypedData.message,
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
            amount: ethers.formatEther(swapData.amount), // WETH uses 18 decimals
            userAddress: swapData.userAddress,
            createdAt: swapData.createdAt,
            srcEscrowAddress: swapData.srcEscrowAddress || null,
            dstEscrowAddress: swapData.dstEscrowAddress || null
        }
    })
})

// Async swap execution function - Based on proven arb-sep.js logic
async function executeSwapAsync(swapData) {
    try {
        console.log(`🔄 Executing swap for ${swapData.userAddress}...`)

        // Setup contracts using the same approach as arb-sep.js (EscrowFactory for both chains)
        const srcFactoryContract = new ethers.Contract(swapData.srcFactoryAddress, factoryContract.abi, srcRelayer)
        const dstFactoryContract = new ethers.Contract(swapData.dstFactoryAddress, factoryContract.abi, dstRelayer)
        const srcToken = new ethers.Contract(config.chain.source.tokens.WETH.address, WETH_ABI, srcRelayer)
        const dstToken = new ethers.Contract(config.chain.destination.tokens.WETH.address, WETH_ABI, dstRelayer)

        // Step 1: Check WETH balance on destination chain (no wrapping - user handles this)
        console.log('   Relayer: Checking WETH balance on destination chain...')
        swapData.status = 'checking_dst_balance'
        activeSwaps.set(swapData.orderHash, swapData)
        
        try {
            // Check current WETH balance
            const currentWethBalance = await dstToken.balanceOf(dstRelayer.address)
            console.log(`   Current WETH balance: ${ethers.formatEther(currentWethBalance)} WETH`)
            
            if (currentWethBalance < swapData.amount) {
                console.log(`   ❌ Insufficient WETH balance: ${ethers.formatEther(currentWethBalance)} < ${ethers.formatEther(swapData.amount)}`)
                throw new Error(`Insufficient WETH balance for swap: ${ethers.formatEther(currentWethBalance)} available, ${ethers.formatEther(swapData.amount)} needed. Please wrap ETH to WETH manually.`)
            }
            
            console.log(`   ✅ Sufficient WETH balance available: ${ethers.formatEther(currentWethBalance)}`)
        } catch (error) {
            console.log(`   ❌ WETH balance check failed: ${error.message}`)
            throw new Error(`Failed to check WETH balance: ${error.message}`)
        }

        // Step 2: Relayer approves WETH on destination chain (adapted from arb-sep.js)
        console.log('   Relayer: Approving WETH spending on destination chain...')
        swapData.status = 'approving_dst'
        activeSwaps.set(swapData.orderHash, swapData)
        
        try {
            // Check current allowance first
            const currentAllowance = await dstToken.allowance(dstRelayer.address, swapData.dstFactoryAddress)
            console.log(`   Current allowance: ${ethers.formatEther(currentAllowance)} WETH`)
            
            if (currentAllowance < swapData.amount) {
                // Check balance before approval
                const dstBalance = await dstToken.balanceOf(dstRelayer.address)
                console.log(`   Relayer destination WETH balance: ${ethers.formatEther(dstBalance)}`)
                
                if (dstBalance < swapData.amount) {
                    throw new Error(`Insufficient relayer balance on destination chain: ${ethers.formatEther(dstBalance)} WETH`)
                }
                
                // Estimate gas for approval
                const gasEstimate = await dstToken.approve.estimateGas(swapData.dstFactoryAddress, swapData.amount)
                console.log(`   Estimated gas for approval: ${gasEstimate.toString()}`)
                
                const approveDstTx = await dstToken.approve(swapData.dstFactoryAddress, swapData.amount, {
                    gasLimit: gasEstimate * 120n / 100n // Add 20% buffer
                })
                console.log(`   Approval transaction hash: ${approveDstTx.hash}`)
                await approveDstTx.wait()
                console.log('   ✅ Relayer approved WETH on destination chain')
            } else {
                console.log('   ✅ WETH already approved on destination chain')
            }
        } catch (error) {
            console.log(`   ❌ Destination chain approval failed: ${error.message}`)
            console.log('   💡 Trying with higher gas limit...')
            
            try {
                const approveDstTx = await dstToken.approve(swapData.dstFactoryAddress, swapData.amount, {
                    gasLimit: 100000n // Use higher gas limit
                })
                await approveDstTx.wait()
                console.log('   ✅ Relayer approved WETH on destination chain (with higher gas)')
            } catch (retryError) {
                console.log(`   ❌ Approval retry failed: ${retryError.message}`)
                throw new Error(`Failed to approve WETH on destination chain: ${retryError.message}`)
            }
        }

        // Step 3: Relayer creates destination escrow (adapted from arb-sep.js)
        console.log('   Relayer: Creating destination escrow with taker tokens...')
        swapData.status = 'creating_dst_escrow'
        activeSwaps.set(swapData.orderHash, swapData)
        
        let dstEscrowAddress
        try {
            // Check balance before creating escrow
            const dstBalance = await dstToken.balanceOf(dstRelayer.address)
            console.log(`   Relayer destination WETH balance: ${ethers.formatEther(dstBalance)}`)
            
            if (dstBalance < swapData.amount) {
                throw new Error(`Insufficient WETH balance for destination escrow: ${ethers.formatEther(dstBalance)} WETH`)
            }
            
            const srcCancellationTimestamp = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
            
            // Debug: Log the dstImmutables structure
            console.log('   Debug - dstImmutables structure:')
            console.log(`     orderHash: ${swapData.dstImmutables.orderHash}`)
            console.log(`     hashlock: ${swapData.dstImmutables.hashlock}`)
            console.log(`     maker: ${swapData.dstImmutables.maker}`)
            console.log(`     taker: ${swapData.dstImmutables.taker}`)
            console.log(`     token: ${swapData.dstImmutables.token}`)
            console.log(`     amount: ${swapData.dstImmutables.amount}`)
            console.log(`     safetyDeposit: ${swapData.dstImmutables.safetyDeposit}`)
            console.log(`     timelocks: ${swapData.dstImmutables.timelocks}`)
            console.log(`     srcCancellationTimestamp: ${srcCancellationTimestamp}`)
            console.log(`     safetyDeposit value being sent: ${swapData.dstImmutables.safetyDeposit}`)
            
            // Estimate gas for createDstEscrow
            const gasEstimate = await dstFactoryContract.createDstEscrow.estimateGas(
                swapData.dstImmutables,
                srcCancellationTimestamp,
                { value: swapData.dstImmutables.safetyDeposit }
            )
            console.log(`   Estimated gas for createDstEscrow: ${gasEstimate.toString()}`)
            
            const createDstEscrowTx = await dstFactoryContract.createDstEscrow(
                swapData.dstImmutables,
                srcCancellationTimestamp,
                { 
                    value: swapData.dstImmutables.safetyDeposit,
                    gasLimit: gasEstimate * 120n / 100n // Add 20% buffer
                }
            )
            console.log(`   CreateDstEscrow transaction hash: ${createDstEscrowTx.hash}`)
            await createDstEscrowTx.wait()
                                                                                                                                                        
            // Get the deployed escrow address from the transaction receipt
            const receipt = await dstProvider.getTransactionReceipt(createDstEscrowTx.hash)
            console.log(`   Transaction receipt logs count: ${receipt.logs.length}`)
            
            // Find the DstEscrowCreated event to get the escrow address
            dstEscrowAddress = null
            for (const log of receipt.logs) {
                try {
                    const parsed = dstFactoryContract.interface.parseLog(log)
                    console.log(`   Found event: ${parsed.name}`)
                    
                    if (parsed.name === 'DstEscrowCreated') {
                        dstEscrowAddress = parsed.args.escrow
                        console.log(`   ✅ Found DstEscrowCreated event with escrow: ${dstEscrowAddress}`)
                        break
                    }
                } catch (e) {
                    console.log(`   Could not parse log: ${e.message}`)
                    console.log(`   Log topics: ${log.topics.join(', ')}`)
                }
            }
            
            if (!dstEscrowAddress) {
                // CRITICAL: We need the actual deployed address, not deterministic
                console.log(`   ❌ CRITICAL ERROR: Could not find destination escrow address in logs!`)
                console.log(`   Available events in logs:`)
                for (const log of receipt.logs) {
                    console.log(`     - Topics: ${log.topics.join(', ')}`)
                    console.log(`     - Data: ${log.data}`)
                }
                throw new Error('Failed to get deployed destination escrow address from transaction logs')
            }
            
            swapData.dstEscrowAddress = dstEscrowAddress
            console.log(`   ✅ Relayer created destination escrow with ${ethers.formatEther(swapData.amount)} WETH`)
            
            // Note: createDstEscrow already handles the WETH transfer to the escrow
        } catch (error) {
            console.log(`   ❌ Destination escrow creation failed: ${error.message}`)
            console.log('   💡 Trying with higher gas limit...')
            
            try {
                const srcCancellationTimestamp = Math.floor(Date.now() / 1000) + 3600
                const createDstEscrowTx = await dstFactoryContract.createDstEscrow(
                    swapData.dstImmutables,
                    srcCancellationTimestamp,
                    { 
                        value: swapData.dstImmutables.safetyDeposit,
                        gasLimit: 300000n // Use higher gas limit
                    }
                )
                await createDstEscrowTx.wait()
                
                // Get the deployed escrow address from the transaction receipt
                const receipt = await dstProvider.getTransactionReceipt(createDstEscrowTx.hash)
                console.log(`   Transaction receipt logs count: ${receipt.logs.length}`)
                
                // Find the DstEscrowCreated event to get the escrow address
                dstEscrowAddress = null
                for (const log of receipt.logs) {
                    try {
                        const parsed = dstFactoryContract.interface.parseLog(log)
                        console.log(`   Found event: ${parsed.name}`)
                        
                        if (parsed.name === 'DstEscrowCreated') {
                            dstEscrowAddress = parsed.args.escrow
                            console.log(`   ✅ Found DstEscrowCreated event with escrow: ${dstEscrowAddress}`)
                            break
                        }
                    } catch (e) {
                        console.log(`   Could not parse log: ${e.message}`)
                        console.log(`   Log topics: ${log.topics.join(', ')}`)
                    }
                }
                
                if (!dstEscrowAddress) {
                    // CRITICAL: We need the actual deployed address, not deterministic
                    console.log(`   ❌ CRITICAL ERROR: Could not find destination escrow address in logs!`)
                    console.log(`   Available events in logs:`)
                    for (const log of receipt.logs) {
                        console.log(`     - Topics: ${log.topics.join(', ')}`)
                        console.log(`     - Data: ${log.data}`)
                    }
                    throw new Error('Failed to get deployed destination escrow address from transaction logs')
                }
                
                swapData.dstEscrowAddress = dstEscrowAddress
                console.log(`   ✅ Relayer created destination escrow: ${dstEscrowAddress} (with higher gas)`)
                console.log(`   ✅ Relayer created destination escrow with ${ethers.formatEther(swapData.amount)} WETH (with higher gas)`)
                
                // Note: createDstEscrow already handles the WETH transfer to the escrow
            } catch (retryError) {
                console.log(`   ❌ CreateDstEscrow retry failed: ${retryError.message}`)
                throw new Error(`Failed to create destination escrow: ${retryError.message}`)
            }
        }

        // Step 4: Wait for user approval on source chain (USER APPROVES FROM WALLET)
        console.log('   Waiting for user approval on source chain...')
        swapData.status = 'waiting_src_approval'
        activeSwaps.set(swapData.orderHash, swapData)

        // Check for user approval (polling mechanism)
        let approved = false
        let attempts = 0
        const maxAttempts = 60 // 5 minutes

        while (!approved && attempts < maxAttempts) {
            try {
                const allowance = await srcToken.allowance(swapData.userAddress, srcRelayer.address)
                if (allowance >= swapData.amount) {
                    approved = true
                    console.log('   ✅ User WETH approval detected')
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
            throw new Error('User approval timeout - user must approve WETH spending')
        }

        // Step 5: Transfer WETH from user to relayer, then create source escrow
        console.log('   Relayer: Transferring WETH from user to relayer...')
        swapData.status = 'transferring_weth'
        activeSwaps.set(swapData.orderHash, swapData)

        // Transfer WETH from user to relayer first
        try {
            const transferTx = await srcToken.transferFrom(swapData.userAddress, srcRelayer.address, swapData.amount)
            await transferTx.wait()
            console.log('   ✅ WETH transferred from user to relayer')
        } catch (error) {
            console.log(`   ❌ WETH transfer failed: ${error.message}`)
            throw new Error(`Failed to transfer WETH from user: ${error.message}`)
        }

        // Relayer approves WETH spending on source chain (adapted from arb-sep.js)
        console.log('   Relayer: Approving WETH spending on source chain...')
        try {
            // Check current allowance first
            const currentAllowance = await srcToken.allowance(srcRelayer.address, swapData.srcFactoryAddress)
            console.log(`   Current allowance: ${ethers.formatEther(currentAllowance)} WETH`)
            
            if (currentAllowance < swapData.amount) {
                // Estimate gas for approval
                const gasEstimate = await srcToken.approve.estimateGas(swapData.srcFactoryAddress, swapData.amount)
                console.log(`   Estimated gas for approval: ${gasEstimate.toString()}`)
                
                const approveSrcTx = await srcToken.approve(swapData.srcFactoryAddress, swapData.amount, {
                    gasLimit: gasEstimate * 120n / 100n // Add 20% buffer
                })
                console.log(`   Approval transaction hash: ${approveSrcTx.hash}`)
                await approveSrcTx.wait()
                console.log('   ✅ Relayer approved WETH on source chain')
            } else {
                console.log('   ✅ WETH already approved on source chain')
            }
        } catch (error) {
            console.log(`   ❌ Source chain approval failed: ${error.message}`)
            console.log('   💡 Trying with higher gas limit...')
            
            try {
                const approveSrcTx = await srcToken.approve(swapData.srcFactoryAddress, swapData.amount, {
                    gasLimit: 100000n // Use higher gas limit
                })
                await approveSrcTx.wait()
                console.log('   ✅ Relayer approved WETH on source chain (with higher gas)')
            } catch (retryError) {
                console.log(`   ❌ Approval retry failed: ${retryError.message}`)
                throw new Error(`Failed to approve WETH on source chain: ${retryError.message}`)
            }
        }

        // Step 6: Create source escrow (adapted from arb-sep.js logic)
        console.log('   Relayer: Creating source escrow...')
        swapData.status = 'creating_src_escrow'
        activeSwaps.set(swapData.orderHash, swapData)
        
        // Debug: Log the srcImmutables structure
        console.log('   Debug - srcImmutables structure:')
        console.log(`     orderHash: ${swapData.srcImmutables.orderHash}`)
        console.log(`     hashlock: ${swapData.srcImmutables.hashlock}`)
        console.log(`     maker: ${swapData.srcImmutables.maker}`)
        console.log(`     taker: ${swapData.srcImmutables.taker}`)
        console.log(`     token: ${swapData.srcImmutables.token}`)
        console.log(`     amount: ${swapData.srcImmutables.amount}`)
        console.log(`     safetyDeposit: ${swapData.srcImmutables.safetyDeposit}`)
        console.log(`     timelocks: ${swapData.srcImmutables.timelocks}`)
        console.log(`     safetyDeposit value being sent: ${swapData.srcImmutables.safetyDeposit}`)
        
        let srcEscrowAddress
        try {
            // Estimate gas for createSrcEscrow (same as arb-sep.js)
            const gasEstimate = await srcFactoryContract.createSrcEscrow.estimateGas(
                swapData.srcImmutables,
                { value: swapData.srcImmutables.safetyDeposit }
            )
            console.log(`   Estimated gas for createSrcEscrow: ${gasEstimate.toString()}`)
            
            const createSrcEscrowTx = await srcFactoryContract.createSrcEscrow(
                swapData.srcImmutables,
                { 
                    value: swapData.srcImmutables.safetyDeposit,
                    gasLimit: gasEstimate * 120n / 100n // Add 20% buffer
                }
            )
            console.log(`   CreateSrcEscrow transaction hash: ${createSrcEscrowTx.hash}`)
            await createSrcEscrowTx.wait()
            
            // Get the deployed escrow address from the transaction receipt (same as arb-sep.js)
            const receipt = await srcProvider.getTransactionReceipt(createSrcEscrowTx.hash)
            console.log(`   Transaction receipt logs count: ${receipt.logs.length}`)
            
            // Find the escrow creation event to get the escrow address (same as arb-sep.js)
            srcEscrowAddress = null
            for (const log of receipt.logs) {
                try {
                    const parsed = srcFactoryContract.interface.parseLog(log)
                    console.log(`   Found event: ${parsed.name}`)
                    
                    // Check for SrcEscrowCreatedDirect event which contains the escrow address directly
                    if (parsed.name === 'SrcEscrowCreatedDirect') {
                        srcEscrowAddress = parsed.args.escrow
                        console.log(`   ✅ Found SrcEscrowCreatedDirect event with escrow: ${srcEscrowAddress}`)
                        break
                    }
                    // Check for SrcEscrowCreated event (contains full immutables)
                    else if (parsed.name === 'SrcEscrowCreated') {
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
                        srcEscrowAddress = await srcFactoryContract.addressOfEscrowSrc(srcImmutablesForAddress)
                        console.log(`   ✅ Computed escrow address from SrcEscrowCreated: ${srcEscrowAddress}`)
                        break
                    }
                } catch (e) {
                    console.log(`   Could not parse log: ${e.message}`)
                    console.log(`   Log topics: ${log.topics.join(', ')}`)
                }
            }
            
            if (!srcEscrowAddress) {
                // CRITICAL: We need the actual deployed address, not deterministic
                console.log(`   ❌ CRITICAL ERROR: Could not find escrow address in logs!`)
                console.log(`   Available events in logs:`)
                for (const log of receipt.logs) {
                    console.log(`     - Topics: ${log.topics.join(', ')}`)
                    console.log(`     - Data: ${log.data}`)
                }
                throw new Error('Failed to get deployed source escrow address from transaction logs')
            }
            
            swapData.srcEscrowAddress = srcEscrowAddress
            console.log(`   ✅ Source escrow created: ${srcEscrowAddress}`)
        } catch (error) {
            console.log(`   ❌ Source escrow creation failed: ${error.message}`)
            console.log('   💡 Trying with higher gas limit...')
            
            try {
                const createSrcEscrowTx = await srcFactoryContract.createSrcEscrow(
                    swapData.srcImmutables,
                    { 
                        value: swapData.srcImmutables.safetyDeposit,
                        gasLimit: 300000n // Use higher gas limit
                    }
                )
                await createSrcEscrowTx.wait()
                
                // Get the deployed escrow address from the transaction receipt
                const receipt = await srcProvider.getTransactionReceipt(createSrcEscrowTx.hash)
                console.log(`   Transaction receipt logs count: ${receipt.logs.length}`)
                
                // Find the escrow creation event to get the escrow address
                srcEscrowAddress = null
                for (const log of receipt.logs) {
                    try {
                        const parsed = srcFactoryContract.interface.parseLog(log)
                        console.log(`   Found event: ${parsed.name}`)
                        
                        // Check for SrcEscrowCreatedDirect event which contains the escrow address directly
                        if (parsed.name === 'SrcEscrowCreatedDirect') {
                            srcEscrowAddress = parsed.args.escrow
                            console.log(`   ✅ Found SrcEscrowCreatedDirect event with escrow: ${srcEscrowAddress}`)
                            break
                        }
                        // Check for SrcEscrowCreated event (contains full immutables)
                        else if (parsed.name === 'SrcEscrowCreated') {
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
                            srcEscrowAddress = await srcFactoryContract.addressOfEscrowSrc(srcImmutablesForAddress)
                            console.log(`   ✅ Computed escrow address from SrcEscrowCreated: ${srcEscrowAddress}`)
                            break
                        }
                    } catch (e) {
                        console.log(`   Could not parse log: ${e.message}`)
                        console.log(`   Log topics: ${log.topics.join(', ')}`)
                    }
                }
                
                if (!srcEscrowAddress) {
                    // CRITICAL: We need the actual deployed address, not deterministic
                    console.log(`   ❌ CRITICAL ERROR: Could not find escrow address in logs!`)
                    console.log(`   Available events in logs:`)
                    for (const log of receipt.logs) {
                        console.log(`     - Topics: ${log.topics.join(', ')}`)
                        console.log(`     - Data: ${log.data}`)
                    }
                    throw new Error('Failed to get deployed source escrow address from transaction logs')
                }
                
                swapData.srcEscrowAddress = srcEscrowAddress
                console.log(`   ✅ Source escrow created: ${srcEscrowAddress} (with higher gas)`)
            } catch (retryError) {
                console.log(`   ❌ CreateSrcEscrow retry failed: ${retryError.message}`)
                throw new Error(`Failed to create source escrow: ${retryError.message}`)
            }
        }

        // Step 7: Verify funds are locked (adapted from arb-sep.js)
        console.log('   🔍 Verifying funds are locked...')
        const srcEscrowBalance = await srcToken.balanceOf(srcEscrowAddress)
        const dstEscrowBalance = await dstToken.balanceOf(dstEscrowAddress)
        const srcEscrowEth = await srcProvider.getBalance(srcEscrowAddress)
        const dstEscrowEth = await dstProvider.getBalance(dstEscrowAddress)
        
        console.log(`   Source escrow WETH: ${ethers.formatEther(srcEscrowBalance)}`)
        console.log(`   Destination escrow WETH: ${ethers.formatEther(dstEscrowBalance)}`)
        console.log(`   Source escrow ETH: ${ethers.formatEther(srcEscrowEth)}`)
        console.log(`   Destination escrow ETH: ${ethers.formatEther(dstEscrowEth)}`)
        
        if (srcEscrowBalance >= swapData.amount && dstEscrowBalance >= swapData.amount) {
            console.log('   ✅ Funds successfully locked in both escrow contracts!')
        } else {
            console.log('   ❌ Funds not properly locked')
            throw new Error('Funds not properly locked in escrow contracts')
        }

        // Step 8: Wait for finality then execute withdrawals
        console.log('   Waiting for finality...')
        await new Promise(resolve => setTimeout(resolve, 10000)) // Wait 10 seconds

        // Step 9: Withdraw from source escrow (adapted from arb-sep.js)
        console.log('   Relayer: Withdrawing from source escrow...')
        swapData.status = 'withdrawing_src'
        activeSwaps.set(swapData.orderHash, swapData)

        try {
            // Check escrow balance before withdrawal
            const srcEscrowBalanceBefore = await srcToken.balanceOf(srcEscrowAddress)
            console.log(`   Source escrow balance before withdrawal: ${ethers.formatEther(srcEscrowBalanceBefore)} WETH`)
            
            // Use direct escrow contract for withdrawal (like in arb-sep.js)
            const srcEscrowContract = new ethers.Contract(srcEscrowAddress, ESCROW_ABI, srcRelayer)
            
            try {
                const gasEstimate = await srcEscrowContract.withdraw.estimateGas(swapData.secret, swapData.srcImmutables)
                console.log(`   Direct escrow gas estimate: ${gasEstimate.toString()}`)
                
                const withdrawSrcTx = await srcEscrowContract.withdraw(swapData.secret, swapData.srcImmutables, {
                    gasLimit: gasEstimate * 120n / 100n // Add 20% buffer
                })
                console.log(`   Source withdrawal transaction hash: ${withdrawSrcTx.hash}`)
                await withdrawSrcTx.wait()
                
                // Verify withdrawal
                const srcEscrowBalanceAfter = await srcToken.balanceOf(srcEscrowAddress)
                console.log(`   Source escrow balance after withdrawal: ${ethers.formatEther(srcEscrowBalanceAfter)} WETH`)
                
                if (srcEscrowBalanceAfter < srcEscrowBalanceBefore) {
                    console.log('   ✅ Relayer successfully withdrew tokens from source escrow')
                } else {
                    console.log('   ❌ Source withdrawal may have failed - balance unchanged')
                }
                console.log('   🔓 Secret is now public on source chain')
            } catch (error) {
                console.log(`   ❌ Direct escrow withdrawal failed: ${error.message}`)
                console.log('   💡 Trying with higher gas limit...')
                
                const withdrawSrcTx = await srcEscrowContract.withdraw(swapData.secret, swapData.srcImmutables, {
                    gasLimit: 200000n // Use higher gas limit
                })
                await withdrawSrcTx.wait()
                console.log('   ✅ Relayer withdrew tokens from source escrow (with higher gas)')
            }
        } catch (error) {
            console.log(`   ❌ Source escrow withdrawal failed: ${error.message}`)
            throw new Error(`Failed to withdraw from source escrow: ${error.message}`)
        }

        // Step 10: Withdraw from destination escrow (adapted from arb-sep.js)
        console.log('   Relayer: Withdrawing from destination escrow...')
        swapData.status = 'withdrawing_dst'
        activeSwaps.set(swapData.orderHash, swapData)

        try {
            // Check escrow balance before withdrawal
            const dstEscrowBalanceBefore = await dstToken.balanceOf(dstEscrowAddress)
            console.log(`   Destination escrow balance before withdrawal: ${ethers.formatEther(dstEscrowBalanceBefore)} WETH`)
            
            // Use direct escrow contract for withdrawal (like in arb-sep.js)
            const dstEscrowContract = new ethers.Contract(dstEscrowAddress, ESCROW_ABI, dstRelayer)
            
            try {
                const gasEstimate = await dstEscrowContract.withdraw.estimateGas(swapData.secret, swapData.dstImmutables)
                console.log(`   Direct escrow gas estimate: ${gasEstimate.toString()}`)
                
                const withdrawDstTx = await dstEscrowContract.withdraw(swapData.secret, swapData.dstImmutables, {
                    gasLimit: gasEstimate * 120n / 100n // Add 20% buffer
                })
                console.log(`   Destination withdrawal transaction hash: ${withdrawDstTx.hash}`)
                await withdrawDstTx.wait()
                
                // Verify withdrawal
                const dstEscrowBalanceAfter = await dstToken.balanceOf(dstEscrowAddress)
                console.log(`   Destination escrow balance after withdrawal: ${ethers.formatEther(dstEscrowBalanceAfter)} WETH`)
                
                if (dstEscrowBalanceAfter < dstEscrowBalanceBefore) {
                    console.log('   ✅ Relayer successfully withdrew tokens from destination escrow')
                } else {
                    console.log('   ❌ Destination withdrawal may have failed - balance unchanged')
                }
                console.log('   🎉 Cross-chain swap completed successfully!')
            } catch (error) {
                console.log(`   ❌ Direct escrow withdrawal failed: ${error.message}`)
                console.log('   💡 Trying with higher gas limit...')
                
                const withdrawDstTx = await dstEscrowContract.withdraw(swapData.secret, swapData.dstImmutables, {
                    gasLimit: 200000n // Use higher gas limit
                })
                await withdrawDstTx.wait()
                console.log('   ✅ Relayer withdrew tokens from destination escrow (with higher gas)')
            }
        } catch (error) {
            console.log(`   ❌ Destination escrow withdrawal failed: ${error.message}`)
            throw new Error(`Failed to withdraw from destination escrow: ${error.message}`)
        }

        // Step 11: Transfer destination WETH to user (with optional unwrapping)
        console.log('   Relayer: Transferring destination WETH to user...')
        try {
            // Option 1: Transfer WETH directly to user
            const transferTx = await dstToken.transfer(swapData.userAddress, swapData.amount)
            await transferTx.wait()
            console.log('   ✅ Destination WETH transferred to user')
            
            // Optional: Add unwrapping logic here if user prefers ETH
            // const unwrapTx = await dstToken.withdraw(swapData.amount)
            // await unwrapTx.wait()
            // Then send ETH to user...
            
        } catch (error) {
            console.log(`   ❌ WETH transfer to user failed: ${error.message}`)
            throw new Error(`Failed to transfer WETH to user: ${error.message}`)
        }

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

// Global variables to store deployed contracts
let deployedContracts = null

// Auto-deploy contracts on startup
async function initializeServer() {
    try {
        console.log('🔧 Initializing server and deploying contracts...')
        
        // Try to load existing contracts first
        try {
            const fs = await import('fs')
            const existingContracts = JSON.parse(fs.readFileSync('./deployed-contracts.json', 'utf8'))
            console.log('📋 Found existing deployed contracts')
            deployedContracts = existingContracts
        } catch (e) {
            console.log('📋 No existing contracts found, will deploy fresh ones')
        }
        
        // Always deploy fresh contracts on server start (ignore existing ones)
        console.log('🚀 Deploying fresh contracts on server startup...')
        
        try {
            console.log('🚀 Deploying contracts on Sepolia...')
            const srcDeployment = await deployContracts(srcProvider, srcRelayer, config.chain.source, 'Sepolia')
            
            console.log('🚀 Deploying contracts on Monad...')
            const dstDeployment = await deployContracts(dstProvider, dstRelayer, config.chain.destination, 'Monad')
            
            deployedContracts = {
                sepolia: {
                    escrowFactory: srcDeployment.escrowFactory,
                    resolver: srcDeployment.resolver,
                    lastDeployed: new Date().toISOString()
                },
                monad: {
                    escrowFactory: dstDeployment.escrowFactory,
                    resolver: dstDeployment.resolver,
                    lastDeployed: new Date().toISOString()
                }
            }
            
            // Save deployed contracts
            const fs = await import('fs')
            fs.writeFileSync('./deployed-contracts.json', JSON.stringify(deployedContracts, null, 2))
            console.log('💾 Saved deployed contracts to file')
            
            console.log('✅ Contract deployment complete')
            console.log(`📋 Sepolia Factory: ${deployedContracts.sepolia.escrowFactory}`)
            console.log(`📋 Monad Factory: ${deployedContracts.monad.escrowFactory}`)
        } catch (deploymentError) {
            console.error('❌ Contract deployment failed:', deploymentError.message)
            console.log('⚠️ Server will continue without fresh deployments')
            
            // If we have existing contracts, use those
            if (!deployedContracts) {
                console.log('❌ No existing contracts available, some features may not work')
                deployedContracts = null
            }
        }
        
        console.log('✅ Server initialization complete')
        
    } catch (error) {
        console.error('❌ Server initialization failed:', error)
        console.log('⚠️ Server will start anyway, but some features may not work properly')
        deployedContracts = null
    }
}

// Start server
// Start server
async function startServer() {
    try {
        console.log(`🚀 Cross-chain swap relayer server starting on port ${PORT}`)
        console.log(`📡 Health check: http://localhost:${PORT}/health`)
        
        // Validate environment variables first
        if (!process.env.PRIVATE_KEY || !process.env.SRC_CHAIN_RPC || !process.env.DST_CHAIN_RPC) {
            console.error('❌ Missing required environment variables: PRIVATE_KEY, SRC_CHAIN_RPC, DST_CHAIN_RPC')
            process.exit(1)
        }
        
        console.log('✅ Environment variables validated')
        
        // Initialize server and deploy contracts
        await initializeServer()
        
        // Start the HTTP server
        app.listen(PORT, () => {
            console.log(`🎯 Server is ready to accept requests on port ${PORT}!`)
            console.log('💡 Press Ctrl+C to stop the server')
        })
        
    } catch (error) {
        console.error('❌ Failed to start server:', error)
        process.exit(1)
    }
}

// Start the server
startServer()

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down relayer server...')
    process.exit(0)
}) 