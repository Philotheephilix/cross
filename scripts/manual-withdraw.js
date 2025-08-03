import 'dotenv/config'
import { ethers } from 'ethers'
import { randomBytes } from 'crypto'

// Load environment variables
const privateKey = process.env.PRIVATE_KEY
const srcChainRpc = process.env.SRC_CHAIN_RPC
const dstChainRpc = process.env.DST_CHAIN_RPC

if (!privateKey || !srcChainRpc || !dstChainRpc) {
    console.error('❌ Missing environment variables')
    console.error('Please set: PRIVATE_KEY, SRC_CHAIN_RPC, DST_CHAIN_RPC')
    process.exit(1)
}

// Contract ABIs
const ESCROW_ABI = [
    'function withdraw(bytes32 secret, tuple(uint256 maker, uint256 taker, uint256 token, uint256 timelocks) immutables) external',
    'function cancel(tuple(uint256 maker, uint256 taker, uint256 token, uint256 timelocks) immutables) external',
    'function getEscrowInfo(tuple(uint256 maker, uint256 taker, uint256 token, uint256 timelocks) immutables) external view returns (address escrow, bool exists)'
]

const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)'
]

async function main() {
    console.log('🔓 Manual Fund Withdrawal Script')
    console.log('================================')
    
    // Setup providers and wallet
    const srcProvider = new ethers.JsonRpcProvider(srcChainRpc)
    const dstProvider = new ethers.JsonRpcProvider(dstChainRpc)
    const wallet = new ethers.Wallet(privateKey)
    const srcUser = wallet.connect(srcProvider)
    const dstUser = wallet.connect(dstProvider)
    
    // USDC addresses
    const SRC_USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' // Sepolia
    const DST_USDC = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' // Arbitrum Sepolia
    
    // Escrow addresses from the last run
    const srcEscrowAddress = '0xf200b9F92A5577bEa7aE400E7809bafd066289CE'
    const dstEscrowAddress = '0x6DD68565335a0A6e3c1c86283e010D4C2B2f7334'
    
    // Secret from the last run
    const secret = '0x27f022ab3dc007936ae3ba6ff0b15b08f74d91bd6b3044cb80b5907004a3e6cc'
    
    // Create token contracts
    const srcToken = new ethers.Contract(SRC_USDC, ERC20_ABI, srcUser)
    const dstToken = new ethers.Contract(DST_USDC, ERC20_ABI, dstUser)
    
    // Create escrow contracts
    const srcEscrow = new ethers.Contract(srcEscrowAddress, ESCROW_ABI, srcUser)
    const dstEscrow = new ethers.Contract(dstEscrowAddress, ESCROW_ABI, dstUser)
    
    console.log('📊 Current Balances:')
    const srcBalance = await srcToken.balanceOf(srcUser.address)
    const dstBalance = await dstToken.balanceOf(dstUser.address)
    const srcEscrowBalance = await srcToken.balanceOf(srcEscrowAddress)
    const dstEscrowBalance = await dstToken.balanceOf(dstEscrowAddress)
    
    console.log(`   Source wallet: ${ethers.formatUnits(srcBalance, 6)} USDC`)
    console.log(`   Destination wallet: ${ethers.formatUnits(dstBalance, 6)} USDC`)
    console.log(`   Source escrow: ${ethers.formatUnits(srcEscrowBalance, 6)} USDC`)
    console.log(`   Destination escrow: ${ethers.formatUnits(dstEscrowBalance, 6)} USDC`)
    
    if (srcEscrowBalance === 0n && dstEscrowBalance === 0n) {
        console.log('✅ No funds locked in escrows')
        return
    }
    
    console.log('\n🔑 Using secret:', secret)
    
    // Create immutables (simplified for manual withdrawal)
    const srcImmutables = {
        maker: BigInt(srcUser.address),
        taker: BigInt(srcUser.address),
        token: BigInt(SRC_USDC),
        timelocks: BigInt(Math.floor(Date.now() / 1000) + 3600)
    }
    
    const dstImmutables = {
        maker: BigInt(dstUser.address),
        taker: BigInt(dstUser.address),
        token: BigInt(DST_USDC),
        timelocks: BigInt(Math.floor(Date.now() / 1000) + 3600)
    }
    
    // Try to withdraw from source escrow
    if (srcEscrowBalance > 0n) {
        console.log('\n📤 Withdrawing from source escrow...')
        try {
            // Check if escrow exists
            const srcEscrowInfo = await srcEscrow.getEscrowInfo(srcImmutables)
            console.log(`   Escrow exists: ${srcEscrowInfo.exists}`)
            console.log(`   Escrow address: ${srcEscrowInfo.escrow}`)
            
            const gasEstimate = await srcEscrow.withdraw.estimateGas(secret, srcImmutables)
            console.log(`   Estimated gas: ${gasEstimate.toString()}`)
            
            const tx = await srcEscrow.withdraw(secret, srcImmutables, {
                gasLimit: gasEstimate * 120n / 100n
            })
            console.log(`   Transaction hash: ${tx.hash}`)
            await tx.wait()
            console.log('   ✅ Source withdrawal successful!')
        } catch (error) {
            console.log(`   ❌ Source withdrawal failed: ${error.message}`)
        }
    }
    
    // Try to withdraw from destination escrow
    if (dstEscrowBalance > 0n) {
        console.log('\n📤 Withdrawing from destination escrow...')
        try {
            // Check if escrow exists
            const dstEscrowInfo = await dstEscrow.getEscrowInfo(dstImmutables)
            console.log(`   Escrow exists: ${dstEscrowInfo.exists}`)
            console.log(`   Escrow address: ${dstEscrowInfo.escrow}`)
            
            const gasEstimate = await dstEscrow.withdraw.estimateGas(secret, dstImmutables)
            console.log(`   Estimated gas: ${gasEstimate.toString()}`)
            
            const tx = await dstEscrow.withdraw(secret, dstImmutables, {
                gasLimit: gasEstimate * 120n / 100n
            })
            console.log(`   Transaction hash: ${tx.hash}`)
            await tx.wait()
            console.log('   ✅ Destination withdrawal successful!')
        } catch (error) {
            console.log(`   ❌ Destination withdrawal failed: ${error.message}`)
        }
    }
    
    // Final balance check
    console.log('\n📊 Final Balances:')
    const finalSrcBalance = await srcToken.balanceOf(srcUser.address)
    const finalDstBalance = await dstToken.balanceOf(dstUser.address)
    const finalSrcEscrowBalance = await srcToken.balanceOf(srcEscrowAddress)
    const finalDstEscrowBalance = await dstToken.balanceOf(dstEscrowAddress)
    
    console.log(`   Source wallet: ${ethers.formatUnits(finalSrcBalance, 6)} USDC`)
    console.log(`   Destination wallet: ${ethers.formatUnits(finalDstBalance, 6)} USDC`)
    console.log(`   Source escrow: ${ethers.formatUnits(finalSrcEscrowBalance, 6)} USDC`)
    console.log(`   Destination escrow: ${ethers.formatUnits(finalDstEscrowBalance, 6)} USDC`)
    
    if (finalSrcEscrowBalance === 0n && finalDstEscrowBalance === 0n) {
        console.log('\n🎉 All funds successfully withdrawn!')
    } else {
        console.log('\n⚠️  Some funds may still be locked')
    }
}

main().catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
}) 