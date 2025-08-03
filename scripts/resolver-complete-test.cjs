const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = require('../tests/config.js');

// Contract ABIs
const RESOLVER_ABI = require('../dist/contracts/Resolver.json').abi;
const TEST_ESCROW_FACTORY_ABI = require('../dist/contracts/TestEscrowFactory.json').abi;
const WETH_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function mint(address to, uint256 amount)',
    'function deposit() payable'
];

// SDK utilities
const { Address, Timelocks } = require('../tests/custom-sdk.js');

async function main() {
    console.log('🚀 Starting Complete Resolver Test...\n');

    // Load environment variables
    require('dotenv').config();

    // Setup providers and wallets
    const srcProvider = new ethers.JsonRpcProvider(process.env.SRC_CHAIN_RPC);
    const dstProvider = new ethers.JsonRpcProvider(process.env.DST_CHAIN_RPC);
    
    const srcWallet = new ethers.Wallet(process.env.PRIVATE_KEY, srcProvider);
    const dstWallet = new ethers.Wallet(process.env.PRIVATE_KEY, dstProvider);

    console.log('📋 Wallet Addresses:');
    console.log(`   Source Chain: ${srcWallet.address}`);
    console.log(`   Destination Chain: ${dstWallet.address}\n`);

    // Load deployed contracts
    let deployedContracts = {};
    try {
        deployedContracts = JSON.parse(fs.readFileSync('deployed-contracts.json', 'utf8'));
    } catch (error) {
        console.log('⚠️ No deployed contracts found, will deploy new ones');
        deployedContracts = { sepolia: {}, arbitrumSepolia: {} };
    }

    // Deploy contracts function
    async function deployContracts(provider, wallet, chainName, deployedContracts) {
        console.log(`🔨 Deploying contracts on ${chainName}...`);
        
        // Deploy TestEscrowFactory
        const factoryFactory = new ethers.ContractFactory(
            TEST_ESCROW_FACTORY_ABI.abi,
            TEST_ESCROW_FACTORY_ABI.bytecode,
            wallet
        );

        const chainConfig = config.chain[chainName === 'sepolia' ? 'source' : 'destination'];
        
        console.log(`   Deploying TestEscrowFactory with parameters:`);
        console.log(`     limitOrderProtocol: ${chainConfig.limitOrderProtocol}`);
        console.log(`     feeToken: ${ethers.ZeroAddress}`);
        console.log(`     accessToken: ${ethers.ZeroAddress}`);
        console.log(`     owner: ${wallet.address}`);
        console.log(`     rescueDelaySrc: 3600`);
        console.log(`     rescueDelayDst: 3600`);

        const factory = await factoryFactory.deploy(
            chainConfig.limitOrderProtocol,
            ethers.ZeroAddress, // feeToken
            ethers.ZeroAddress, // accessToken
            wallet.address, // owner
            3600, // rescueDelaySrc
            3600  // rescueDelayDst
        );
        await factory.waitForDeployment();
        const factoryAddress = await factory.getAddress();
        console.log(`   ✅ TestEscrowFactory deployed: ${factoryAddress}`);

        // Deploy Resolver
        const resolverFactory = new ethers.ContractFactory(
            RESOLVER_ABI.abi,
            RESOLVER_ABI.bytecode,
            wallet
        );

        const resolver = await resolverFactory.deploy(
            factoryAddress,
            chainConfig.limitOrderProtocol,
            wallet.address // initialOwner
        );
        await resolver.waitForDeployment();
        const resolverAddress = await resolver.getAddress();
        console.log(`   ✅ Resolver deployed: ${resolverAddress}`);

        // Update deployed contracts
        deployedContracts[chainName] = {
            escrowFactory: factoryAddress,
            resolver: resolverAddress,
            lastDeployed: new Date().toISOString()
        };

        // Save to file
        fs.writeFileSync('deployed-contracts.json', JSON.stringify(deployedContracts, null, 2));
        
        return { factory: factory, resolver: resolver };
    }

    // Deploy on source chain (Sepolia)
    let srcContracts;
    if (!deployedContracts.sepolia.escrowFactory || !deployedContracts.sepolia.resolver) {
        srcContracts = await deployContracts(srcProvider, srcWallet, 'sepolia', deployedContracts);
    } else {
        console.log('✅ Sepolia contracts already deployed');
        const factory = new ethers.Contract(deployedContracts.sepolia.escrowFactory, TEST_ESCROW_FACTORY_ABI.abi, srcWallet);
        const resolver = new ethers.Contract(deployedContracts.sepolia.resolver, RESOLVER_ABI.abi, srcWallet);
        srcContracts = { factory, resolver };
    }

    // Deploy on destination chain (Arbitrum Sepolia)
    let dstContracts;
    if (!deployedContracts.arbitrumSepolia.escrowFactory || !deployedContracts.arbitrumSepolia.resolver) {
        dstContracts = await deployContracts(dstProvider, dstWallet, 'arbitrumSepolia', deployedContracts);
    } else {
        console.log('✅ Arbitrum Sepolia contracts already deployed');
        const factory = new ethers.Contract(deployedContracts.arbitrumSepolia.escrowFactory, TEST_ESCROW_FACTORY_ABI.abi, dstWallet);
        const resolver = new ethers.Contract(deployedContracts.arbitrumSepolia.resolver, RESOLVER_ABI.abi, dstWallet);
        dstContracts = { factory, resolver };
    }

    console.log('\n📊 Contract Addresses:');
    console.log(`   Sepolia Factory: ${await srcContracts.factory.getAddress()}`);
    console.log(`   Sepolia Resolver: ${await srcContracts.resolver.getAddress()}`);
    console.log(`   Arbitrum Sepolia Factory: ${await dstContracts.factory.getAddress()}`);
    console.log(`   Arbitrum Sepolia Resolver: ${await dstContracts.resolver.getAddress()}\n`);

    // Setup test parameters
    const swapAmount = ethers.parseEther('0.1');
    const safetyDeposit = ethers.parseEther('0.01');
    
    // Generate secret and hashlock
    const secret = ethers.randomBytes(32);
    const hashlock = ethers.keccak256(secret);
    
    console.log('🔐 Generated Secret and Hashlock:');
    console.log(`   Secret: ${secret}`);
    console.log(`   Hashlock: ${hashlock}\n`);

    // Create timelocks
    const timelocks = Timelocks.wrap(0); // Start with zero, will be set during deployment

    // Create order using SDK
    console.log('📝 Creating order using custom SDK...');
    const { createOrder, getImmutables } = require('../tests/custom-sdk.js');
    
    const order = await createOrder({
        maker: srcWallet.address,
        taker: dstWallet.address,
        token: config.chain.source.tokens.WETH.address,
        amount: swapAmount,
        hashlock: hashlock,
        timelocks: timelocks
    });

    console.log(`   ✅ Order created with hash: ${order.orderHash}\n`);

    // Get immutables for source chain
    const srcImmutablesRaw = getImmutables({
        orderHash: order.orderHash,
        hashlock: hashlock,
        maker: srcWallet.address,
        taker: dstWallet.address,
        token: config.chain.source.tokens.WETH.address,
        amount: swapAmount,
        safetyDeposit: safetyDeposit,
        timelocks: timelocks
    });

    // Convert addresses to proper format for contract calls
    const srcImmutables = {
        orderHash: srcImmutablesRaw.orderHash,
        hashlock: srcImmutablesRaw.hashlock,
        maker: Address.wrap(BigInt(srcImmutablesRaw.maker)),
        taker: Address.wrap(BigInt(srcImmutablesRaw.taker)),
        token: Address.wrap(BigInt(srcImmutablesRaw.token)),
        amount: srcImmutablesRaw.amount,
        safetyDeposit: safetyDeposit,
        timelocks: srcImmutablesRaw.timelocks
    };

    // Get immutables for destination chain
    const dstImmutablesRaw = getImmutables({
        orderHash: srcImmutablesRaw.orderHash,
        hashlock: srcImmutablesRaw.hashlock,
        maker: srcWallet.address,
        taker: dstWallet.address,
        token: config.chain.destination.tokens.WETH.address,
        amount: swapAmount,
        safetyDeposit: safetyDeposit,
        timelocks: timelocks
    });

    const dstImmutables = {
        orderHash: dstImmutablesRaw.orderHash,
        hashlock: dstImmutablesRaw.hashlock,
        maker: Address.wrap(BigInt(dstImmutablesRaw.maker)),
        taker: Address.wrap(BigInt(dstImmutablesRaw.taker)),
        token: Address.wrap(BigInt(dstImmutablesRaw.token)),
        amount: dstImmutablesRaw.amount,
        safetyDeposit: safetyDeposit,
        timelocks: dstImmutablesRaw.timelocks
    };

    console.log('📋 Immutables created:');
    console.log(`   Source Order Hash: ${srcImmutables.orderHash}`);
    console.log(`   Destination Order Hash: ${dstImmutables.orderHash}\n`);

    // Deploy escrow on source chain using resolver
    console.log('🔨 Deploying escrow on source chain (Sepolia)...');
    
    // Prepare order parameters for LOP
    const orderParams = {
        order: order,
        r: '0x' + '0'.repeat(64), // Placeholder signature
        vs: '0x' + '0'.repeat(64), // Placeholder signature
        amount: swapAmount,
        takerTraits: 0, // Will be modified by resolver
        args: '0x' // Empty args, will be modified by resolver
    };

    try {
        const deploySrcTx = await srcContracts.resolver.deploySrc(
            srcImmutables,
            orderParams.order,
            orderParams.r,
            orderParams.vs,
            orderParams.amount,
            orderParams.takerTraits,
            orderParams.args,
            { value: safetyDeposit }
        );
        
        const deploySrcReceipt = await deploySrcTx.wait();
        console.log(`   ✅ Source escrow deployed in tx: ${deploySrcReceipt.hash}`);
        
        // Get the computed escrow address
        const srcEscrowAddress = await srcContracts.factory.addressOfEscrowSrc(srcImmutables);
        console.log(`   📍 Source escrow address: ${srcEscrowAddress}`);
        
    } catch (error) {
        console.error('   ❌ Failed to deploy source escrow:', error.message);
        return;
    }

    // Deploy escrow on destination chain using resolver
    console.log('\n🔨 Deploying escrow on destination chain (Arbitrum Sepolia)...');
    
    try {
        const deployDstTx = await dstContracts.resolver.deployDst(
            dstImmutables,
            Math.floor(Date.now() / 1000) + 3600, // srcCancellationTimestamp: 1 hour from now
            { value: safetyDeposit }
        );
        
        const deployDstReceipt = await deployDstTx.wait();
        console.log(`   ✅ Destination escrow deployed in tx: ${deployDstReceipt.hash}`);
        
        // Get the computed escrow address
        const dstEscrowAddress = await dstContracts.factory.addressOfEscrowDst(dstImmutables);
        console.log(`   📍 Destination escrow address: ${dstEscrowAddress}`);
        
    } catch (error) {
        console.error('   ❌ Failed to deploy destination escrow:', error.message);
        return;
    }

    console.log('\n🎉 Escrow deployment completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('   1. Wait for the withdrawal period to start');
    console.log('   2. Use the withdraw function with the secret to unlock funds');
    console.log('   3. Test the complete cross-chain swap flow');
    
    console.log('\n🔑 Test Data:');
    console.log(`   Secret: ${secret}`);
    console.log(`   Hashlock: ${hashlock}`);
    console.log(`   Swap Amount: ${ethers.formatEther(swapAmount)} WETH`);
    console.log(`   Safety Deposit: ${ethers.formatEther(safetyDeposit)} ETH`);
}

main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
}); 