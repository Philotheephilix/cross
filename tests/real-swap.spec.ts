import 'dotenv/config'
import {expect, jest} from '@jest/globals'
import {createServer, CreateServerReturnType} from 'prool'
import {anvil} from 'prool/instances'

import {CustomSDK as Sdk} from './custom-sdk'
import {
    computeAddress,
    Contract,
    ContractFactory,
    JsonRpcProvider,
    MaxUint256,
    parseEther,
    parseUnits,
    Wallet as SignerWallet,
    ethers
} from 'ethers'
import {UINT_40_MAX, uint8ArrayToHex, randomBytes} from './utils'
import assert from 'node:assert'
import {ChainConfig, config} from './config'
import {Wallet} from './wallet'
import {Resolver} from './resolver'
import {EscrowFactory} from './escrow-factory'
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

// Escrow ABI for escrow interactions
const ESCROW_ABI = [
    'function fill(bytes calldata order, bytes calldata signature, bytes calldata interaction) external payable returns (uint256)',
    'function cancel() external',
    'function withdraw() external',
    'function publicWithdraw() external',
    'function publicCancel() external',
    'function getEscrowInfo() external view returns (tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks))'
]

describe('Real Cross-Chain Swap Test', () => {
    let src: {
        node?: CreateServerReturnType
        provider: JsonRpcProvider
        escrowFactory: string
        resolver: string
    }
    let dst: {
        node?: CreateServerReturnType
        provider: JsonRpcProvider
        escrowFactory: string
        resolver: string
    }

    let srcChainUser: SignerWallet
    let dstChainUser: SignerWallet
    let srcResolverContract: Contract
    let dstResolverContract: Contract
    let srcEscrowFactory: Contract
    let dstEscrowFactory: Contract

    const userPk = '0x96fc8157b33348da998464a01a3d03b1f0e842103ddfa8d676cc79ea742bba63'
    const resolverPk = '0x96fc8157b33348da998464a01a3d03b1f0e842103ddfa8d676cc79ea742bba63'

    const srcChainId = config.chain.source.chainId
    const dstChainId = config.chain.destination.chainId

    beforeAll(async () => {
        console.log('Starting real cross-chain swap test...')
        
        // Initialize chains
        src = await initChain(config.chain.source)
        dst = await initChain(config.chain.destination)

        // Setup wallets
        srcChainUser = new SignerWallet(userPk, src.provider)
        dstChainUser = new SignerWallet(userPk, dst.provider)

        // Setup contracts
        srcResolverContract = new Contract(src.resolver, resolverContract.abi, srcChainUser)
        dstResolverContract = new Contract(dst.resolver, resolverContract.abi, dstChainUser)
        srcEscrowFactory = new Contract(src.escrowFactory, factoryContract.abi, srcChainUser)
        dstEscrowFactory = new Contract(dst.escrowFactory, factoryContract.abi, dstChainUser)

        console.log('Setup complete. Ready for real swap test.')
    }, 60000) // 60 second timeout

    it('should perform a real cross-chain USDC swap', async () => {
        const swapAmount = parseUnits('0.1', 6) // 0.1 USDC
        const safetyDeposit = parseEther('0.001') // 0.001 ETH

        // Get initial balances
        const srcToken = new Contract(config.chain.source.tokens.USDC.address, ERC20_ABI, srcChainUser)
        const dstToken = new Contract(config.chain.destination.tokens.USDC.address, ERC20_ABI, dstChainUser)

        const initialSrcBalance = await srcToken.balanceOf(await srcChainUser.getAddress())
        const initialDstBalance = await dstToken.balanceOf(await dstChainUser.getAddress())
        const initialSrcEth = await src.provider.getBalance(await srcChainUser.getAddress())
        const initialDstEth = await dst.provider.getBalance(await dstChainUser.getAddress())

        console.log(`Initial balances:`)
        console.log(`Source USDC: ${ethers.formatUnits(initialSrcBalance, 6)}`)
        console.log(`Destination USDC: ${ethers.formatUnits(initialDstBalance, 6)}`)
        console.log(`Source ETH: ${ethers.formatEther(initialSrcEth)}`)
        console.log(`Destination ETH: ${ethers.formatEther(initialDstEth)}`)

        // Check if user has sufficient USDC on source chain
        if (initialSrcBalance < swapAmount) {
            console.log('Insufficient USDC on source chain. Need to fund the wallet.')
            console.log(`Required: ${ethers.formatUnits(swapAmount, 6)} USDC`)
            console.log(`Available: ${ethers.formatUnits(initialSrcBalance, 6)} USDC`)
            return
        }

        // Check if resolver has sufficient USDC on destination chain
        const resolverDstBalance = await dstToken.balanceOf(await dstResolverContract.getAddress())
        if (resolverDstBalance < swapAmount) {
            console.log('Insufficient USDC in resolver on destination chain.')
            console.log(`Required: ${ethers.formatUnits(swapAmount, 6)} USDC`)
            console.log(`Available: ${ethers.formatUnits(resolverDstBalance, 6)} USDC`)
            return
        }

        // Step 1: Create the order
        const secret = uint8ArrayToHex(randomBytes(32))
        const hashlock = Sdk.HashLock.forSingleFill(secret)
        
        const order = Sdk.CrossChainOrder.new(
            src.escrowFactory,
            {
                salt: Sdk.randBigInt(1000n),
                maker: await srcChainUser.getAddress(),
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

        const orderHash = order.getOrderHash(srcChainId)
        console.log(`Order created with hash: ${orderHash}`)

        // Step 2: Approve USDC spending on source chain
        console.log('Approving USDC spending on source chain...')
        const approveTx = await srcToken.approve(src.escrowFactory, swapAmount)
        await approveTx.wait()
        console.log('USDC approval confirmed')

        // Step 3: Create source escrow immutables
        const srcImmutables = order.toSrcImmutables(
            srcChainId,
            await srcChainUser.getAddress(), // taker
            swapAmount,
            hashlock
        )

        // Step 4: Deploy source escrow
        console.log('Deploying source escrow...')
        const srcEscrowAddress = new Sdk.EscrowFactory(src.escrowFactory).getSrcEscrowAddress(
            srcImmutables,
            await srcEscrowFactory.implementation()
        )
        console.log(`Source escrow address: ${srcEscrowAddress}`)

        // Deploy the escrow by calling the factory
        const deploySrcEscrowTx = await srcEscrowFactory.createEscrow(
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
        console.log('Source escrow deployed')

        // Step 5: Transfer USDC to source escrow
        console.log('Transferring USDC to source escrow...')
        const srcEscrow = new Contract(srcEscrowAddress, ESCROW_ABI, srcChainUser)
        const transferTx = await srcToken.transfer(srcEscrowAddress, swapAmount)
        await transferTx.wait()
        console.log('USDC transferred to source escrow')

        // Step 6: Create destination escrow immutables
        const dstImmutables = {
            ...srcImmutables,
            taker: await dstChainUser.getAddress(),
            amount: swapAmount,
            token: config.chain.destination.tokens.USDC.address,
            safetyDeposit: safetyDeposit,
            timelocks: srcImmutables.timelocks // Use same timelocks for simplicity
        }

        // Step 7: Deploy destination escrow
        console.log('Deploying destination escrow...')
        const dstEscrowAddress = new Sdk.EscrowFactory(dst.escrowFactory).getDstEscrowAddress(
            dstImmutables,
            {
                amount: swapAmount,
                token: config.chain.destination.tokens.USDC.address,
                safetyDeposit: safetyDeposit
            },
            Math.floor(Date.now() / 1000), // deployedAt
            await dstChainUser.getAddress(), // taker
            await dstEscrowFactory.implementation()
        )
        console.log(`Destination escrow address: ${dstEscrowAddress}`)

        const deployDstEscrowTx = await dstEscrowFactory.createEscrow(
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
        console.log('Destination escrow deployed')

        // Step 8: Resolver fills the destination escrow
        console.log('Resolver filling destination escrow...')
        const dstEscrow = new Contract(dstEscrowAddress, ESCROW_ABI, dstChainUser)
        
        // Approve USDC spending for resolver
        const resolverDstToken = new Contract(config.chain.destination.tokens.USDC.address, ERC20_ABI, dstChainUser)
        const resolverApproveTx = await resolverDstToken.approve(dstEscrowAddress, swapAmount)
        await resolverApproveTx.wait()

        // Fill the escrow
        const fillTx = await dstEscrow.fill(
            '0x', // order data (not needed for this implementation)
            '0x', // signature (not needed for this implementation)
            '0x', // interaction data
            { value: 0 }
        )
        await fillTx.wait()
        console.log('Destination escrow filled')

        // Step 9: Reveal secret on source chain to complete the swap
        console.log('Revealing secret on source chain...')
        const revealTx = await srcEscrow.fill(
            '0x', // order data
            '0x', // signature
            ethers.toUtf8Bytes(secret), // interaction data with secret
            { value: 0 }
        )
        await revealTx.wait()
        console.log('Secret revealed, swap completed')

        // Step 10: Check final balances
        const finalSrcBalance = await srcToken.balanceOf(await srcChainUser.getAddress())
        const finalDstBalance = await dstToken.balanceOf(await dstChainUser.getAddress())
        const finalSrcEth = await src.provider.getBalance(await srcChainUser.getAddress())
        const finalDstEth = await dst.provider.getBalance(await dstChainUser.getAddress())

        console.log(`Final balances:`)
        console.log(`Source USDC: ${ethers.formatUnits(finalSrcBalance, 6)}`)
        console.log(`Destination USDC: ${ethers.formatUnits(finalDstBalance, 6)}`)
        console.log(`Source ETH: ${ethers.formatEther(finalSrcEth)}`)
        console.log(`Destination ETH: ${ethers.formatEther(finalDstEth)}`)

        // Verify the swap was successful
        expect(finalDstBalance).toBeGreaterThan(initialDstBalance)
        console.log('✅ Cross-chain swap completed successfully!')
    }, 300000) // 5 minute timeout

    afterAll(async () => {
        // Cleanup
        try {
            if (src?.node) await src.node.stop()
            if (dst?.node) await dst.node.stop()
        } catch (error) {
            console.log('Warning: Error during cleanup:', error.message)
        }
    })
})

async function initChain(
    cnf: ChainConfig
): Promise<{node?: CreateServerReturnType; provider: JsonRpcProvider; escrowFactory: string; resolver: string}> {
    const {node, provider} = await getProvider(cnf)
    const deployer = new SignerWallet(cnf.ownerPrivateKey, provider)

    // Deploy EscrowFactory
    const escrowFactory = await deploy(
        factoryContract,
        [
            cnf.limitOrderProtocol,
            cnf.wrappedNative,
            '0x0000000000000000000000000000000000000000', // accessToken
            deployer.address, // owner
            60 * 30, // src rescue delay
            60 * 30 // dst rescue delay
        ],
        provider,
        deployer
    )
    console.log(`[${cnf.chainId}] Escrow factory deployed to ${escrowFactory}`)

    // Deploy Resolver contract
    const resolver = await deploy(
        resolverContract,
        [
            escrowFactory,
            cnf.limitOrderProtocol,
            computeAddress('0x96fc8157b33348da998464a01a3d03b1f0e842103ddfa8d676cc79ea742bba63') // resolver as owner of contract
        ],
        provider,
        deployer
    )
    console.log(`[${cnf.chainId}] Resolver deployed to ${resolver}`)

    return {node, provider, resolver, escrowFactory}
}

async function getProvider(cnf: ChainConfig): Promise<{node?: CreateServerReturnType; provider: JsonRpcProvider}> {
    if (!cnf.createFork) {
        return {
            provider: new JsonRpcProvider(cnf.url, cnf.chainId, {
                cacheTimeout: -1,
                staticNetwork: true
            })
        }
    }

    const node = createServer({
        instance: anvil({forkUrl: cnf.url, chainId: cnf.chainId}),
        limit: 1
    })
    await node.start()

    const address = node.address()
    assert(address)

    const provider = new JsonRpcProvider(`http://[${address.address}]:${address.port}/1`, cnf.chainId, {
        cacheTimeout: -1,
        staticNetwork: true
    })

    return {
        provider,
        node
    }
}

async function deploy(
    json: {abi: any; bytecode: any},
    params: unknown[],
    provider: JsonRpcProvider,
    deployer: SignerWallet
): Promise<string> {
    const factory = new ContractFactory(json.abi, json.bytecode, deployer)
    const contract = await factory.deploy(...params)
    await contract.waitForDeployment()
    return await contract.getAddress()
} 
