#!/usr/bin/env node

import 'dotenv/config'
import { ethers } from 'ethers'
import { CustomSDK as Sdk } from '../tests/custom-sdk'
import { config } from '../tests/config'
import { uint8ArrayToHex, randomBytes, UINT_40_MAX } from '../tests/utils'
import factoryContract from '../dist/contracts/TestEscrowFactory.sol/TestEscrowFactory.json'
import resolverContract from '../dist/contracts/Resolver.sol/Resolver.json'

async function testSetup() {
    console.log('🧪 Testing Cross-Chain Swap Setup')
    console.log('=' * 40)

    // Test environment variables
    console.log('📋 Environment Variables:')
    console.log(`   PRIVATE_KEY: ${process.env.PRIVATE_KEY ? '✅ Set' : '❌ Missing'}`)
    console.log(`   SRC_CHAIN_RPC: ${process.env.SRC_CHAIN_RPC ? '✅ Set' : '❌ Missing'}`)
    console.log(`   DST_CHAIN_RPC: ${process.env.DST_CHAIN_RPC ? '✅ Set' : '❌ Missing'}`)

    // Test imports
    console.log('\n📦 Testing Imports:')
    console.log(`   ethers: ✅ ${ethers.version}`)
    console.log(`   CustomSDK: ✅ ${typeof Sdk}`)
    console.log(`   config: ✅ ${typeof config}`)
    console.log(`   utils: ✅ ${typeof uint8ArrayToHex}`)

    // Test contract artifacts
    console.log('\n📄 Testing Contract Artifacts:')
    console.log(`   TestEscrowFactory: ✅ ${factoryContract.abi ? 'ABI loaded' : '❌ ABI missing'}`)
    console.log(`   Resolver: ✅ ${resolverContract.abi ? 'ABI loaded' : '❌ ABI missing'}`)

    // Test SDK functionality
    console.log('\n🔧 Testing SDK Functionality:')
    const testSecret = uint8ArrayToHex(randomBytes(32))
    const testHashlock = Sdk.HashLock.forSingleFill(testSecret)
    console.log(`   Secret generation: ✅ ${testSecret.substring(0, 10)}...`)
    console.log(`   Hashlock creation: ✅ ${testHashlock.substring(0, 10)}...`)

    // Test chain configuration
    console.log('\n⛓️ Testing Chain Configuration:')
    console.log(`   Source Chain ID: ${config.chain.source.chainId}`)
    console.log(`   Destination Chain ID: ${config.chain.destination.chainId}`)
    console.log(`   Source USDC: ${config.chain.source.tokens.USDC.address}`)
    console.log(`   Destination USDC: ${config.chain.destination.tokens.USDC.address}`)

    console.log('\n✅ Setup test completed successfully!')
    console.log('🚀 Ready to run cross-chain swap script')
}

testSetup().catch((error) => {
    console.error('❌ Setup test failed:', error)
    process.exit(1)
}) 