import { ethers } from 'ethers'
import { config } from './config'

describe('Simple RPC Test', () => {
    it('should connect to Sepolia RPC', async () => {
        const provider = new ethers.JsonRpcProvider(config.chain.source.url)
        const chainId = await provider.getNetwork()
        console.log('Sepolia chainId:', chainId.chainId)
        expect(chainId.chainId).toBe(11155111n)
    }, 30000)

    it('should connect to Arbitrum Sepolia RPC', async () => {
        const provider = new ethers.JsonRpcProvider(config.chain.destination.url)
        const chainId = await provider.getNetwork()
        console.log('Arbitrum Sepolia chainId:', chainId.chainId)
        expect(chainId.chainId).toBe(421614n)
    }, 30000)

    it('should get wallet address from private key', () => {
        const wallet = new ethers.Wallet(config.chain.source.ownerPrivateKey)
        console.log('Wallet address:', wallet.address)
        expect(wallet.address).toBeDefined()
    })
}) 