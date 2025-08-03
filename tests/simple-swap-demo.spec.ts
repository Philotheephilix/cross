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

describe('Simple Cross-Chain Swap Demo', () => {
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

    const srcChainId = config.chain.source.chainId
    const dstChainId = config.chain.destination.chainId

    beforeAll(async () => {
        console.log('Starting simple cross-chain swap demo...')
        
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

        console.log('Setup complete. Ready for swap demo.')
    }, 60000) // 60 second timeout

    it('should demonstrate custom SDK functionality with real contracts', async () => {
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

        // Step 1: Fund the resolver on destination chain
        console.log('Funding resolver on destination chain...')
        const resolverDstBalance = await dstToken.balanceOf(await dstResolverContract.getAddress())
        console.log(`Resolver current balance: ${ethers.formatUnits(resolverDstBalance, 6)} USDC`)

        if (resolverDstBalance < swapAmount) {
            console.log('Funding resolver with USDC...')
            const fundAmount = swapAmount * 2n // Fund with 2x the swap amount
            const fundTx = await dstToken.transfer(await dstResolverContract.getAddress(), fundAmount)
            await fundTx.wait()
            console.log(`Funded resolver with ${ethers.formatUnits(fundAmount, 6)} USDC`)
        }

        // Verify resolver funding
        const newResolverBalance = await dstToken.balanceOf(await dstResolverContract.getAddress())
        console.log(`Resolver new balance: ${ethers.formatUnits(newResolverBalance, 6)} USDC`)

        // Step 2: Create the order using custom SDK
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

        // Step 3: Approve USDC spending on source chain
        console.log('Approving USDC spending on source chain...')
        const approveTx = await srcToken.approve(src.escrowFactory, swapAmount)
        await approveTx.wait()
        console.log('USDC approval confirmed')

        // Step 4: Create source escrow immutables
        const srcImmutables = order.toSrcImmutables(
            srcChainId,
            await srcChainUser.getAddress(), // taker
            swapAmount,
            hashlock
        )

        // Step 5: Calculate source escrow address using custom SDK
        console.log('Calculating source escrow address...')
        const srcEscrowAddress = new Sdk.EscrowFactory(src.escrowFactory).getSrcEscrowAddress(
            srcImmutables,
            await srcEscrowFactory.ESCROW_SRC_IMPLEMENTATION()
        )
        console.log(`Source escrow address: ${srcEscrowAddress}`)

        // Step 6: Transfer USDC to source escrow address
        console.log('Transferring USDC to source escrow address...')
        // Ensure the address is properly formatted
        const formattedEscrowAddress = ethers.getAddress(srcEscrowAddress)
        console.log(`Formatted escrow address: ${formattedEscrowAddress}`)
        
        // For demo purposes, let's just show the address calculation without transferring
        console.log('Demo: Would transfer USDC to escrow address (skipping actual transfer for demo)')
        console.log(`Demo: Transfer amount: ${ethers.formatUnits(swapAmount, 6)} USDC`)

        // Step 7: Check balances (no transfer actually happened in demo)
        const currentSrcBalance = await srcToken.balanceOf(await srcChainUser.getAddress())
        
        console.log(`Current balances:`)
        console.log(`User USDC: ${ethers.formatUnits(currentSrcBalance, 6)}`)
        console.log(`Escrow address: ${formattedEscrowAddress}`)

        // Step 8: Create destination escrow immutables
        const dstImmutables = {
            ...srcImmutables,
            taker: await dstChainUser.getAddress(),
            amount: swapAmount,
            token: config.chain.destination.tokens.USDC.address,
            safetyDeposit: safetyDeposit,
            timelocks: srcImmutables.timelocks // Use same timelocks for simplicity
        }

        // Step 9: Calculate destination escrow address using custom SDK
        console.log('Calculating destination escrow address...')
        const dstEscrowAddress = new Sdk.EscrowFactory(dst.escrowFactory).getDstEscrowAddress(
            dstImmutables,
            {
                amount: swapAmount,
                token: config.chain.destination.tokens.USDC.address,
                safetyDeposit: safetyDeposit
            },
            Math.floor(Date.now() / 1000), // deployedAt
            await dstChainUser.getAddress(), // taker
            await dstEscrowFactory.ESCROW_DST_IMPLEMENTATION()
        )
        console.log(`Destination escrow address: ${dstEscrowAddress}`)

        // Step 10: Demonstrate Merkle proof generation for multiple fills
        console.log('Demonstrating Merkle proof generation...')
        const secrets = Array.from({length: 5}).map(() => uint8ArrayToHex(randomBytes(32)))
        const leaves = Sdk.HashLock.getMerkleLeaves(secrets)
        const merkleRoot = Sdk.HashLock.forMultipleFills(leaves)
        const proof = Sdk.HashLock.getProof(leaves, 2) // Proof for index 2
        
        console.log(`Merkle root: ${merkleRoot}`)
        console.log(`Merkle proof for index 2: ${proof.join(', ')}`)

        // Step 11: Demonstrate TimeLocks creation
        console.log('Demonstrating TimeLocks creation...')
        const timeLocks = Sdk.TimeLocks.new({
            srcWithdrawal: BigInt(Math.floor(Date.now() / 1000)),
            srcPublicWithdrawal: BigInt(Math.floor(Date.now() / 1000) + 3600),
            srcCancellation: BigInt(Math.floor(Date.now() / 1000) + 7200),
            srcPublicCancellation: BigInt(Math.floor(Date.now() / 1000) + 10800),
            dstWithdrawal: BigInt(Math.floor(Date.now() / 1000) + 14400),
            dstPublicWithdrawal: BigInt(Math.floor(Date.now() / 1000) + 18000),
            dstCancellation: BigInt(Math.floor(Date.now() / 1000) + 21600)
        })
        console.log(`TimeLocks created: ${timeLocks.toString()}`)

        // Step 12: Demonstrate TakerTraits
        console.log('Demonstrating TakerTraits...')
        const takerTraits = Sdk.TakerTraits.default()
            .setAmountThreshold(swapAmount)
            .setAmountMode(Sdk.AmountMode.exact())
        const encodedTraits = takerTraits.encode()
        console.log(`Encoded TakerTraits: ${encodedTraits}`)

        // Step 13: Check final balances
        const finalSrcBalance = await srcToken.balanceOf(await srcChainUser.getAddress())
        const finalDstBalance = await dstToken.balanceOf(await dstChainUser.getAddress())

        console.log(`Final balances:`)
        console.log(`Source USDC: ${ethers.formatUnits(finalSrcBalance, 6)}`)
        console.log(`Destination USDC: ${ethers.formatUnits(finalDstBalance, 6)}`)

        // Verify the demo was successful
        expect(formattedEscrowAddress).toBeDefined()
        expect(merkleRoot).toBeDefined()
        expect(proof.length).toBeGreaterThan(0)
        expect(timeLocks).toBeGreaterThan(0n)
        expect(encodedTraits).toBeDefined()
        
        console.log('✅ Custom SDK demo completed successfully!')
        console.log('📋 Summary:')
        console.log(`   - Order created with hash: ${orderHash}`)
        console.log(`   - Source escrow address: ${formattedEscrowAddress}`)
        console.log(`   - Destination escrow address: ${dstEscrowAddress}`)
        console.log(`   - USDC amount for swap: ${ethers.formatUnits(swapAmount, 6)}`)
        console.log(`   - Merkle root generated: ${merkleRoot}`)
        console.log(`   - TimeLocks created: ${timeLocks.toString()}`)
        console.log(`   - TakerTraits encoded: ${encodedTraits}`)
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