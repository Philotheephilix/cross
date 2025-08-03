import {z} from 'zod'
import Sdk from '@1inch/cross-chain-sdk'
import * as process from 'node:process'

const bool = z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .pipe(z.boolean())

const ConfigSchema = z.object({
    SRC_CHAIN_RPC: z.string().url(),
    DST_CHAIN_RPC: z.string().url(),
    SRC_CHAIN_CREATE_FORK: bool.default('false'),
    DST_CHAIN_CREATE_FORK: bool.default('false')
})

const fromEnv = ConfigSchema.parse(process.env)

export const config = {
    chain: {
        source: {
            chainId: 11155111, // Ethereum Sepolia testnet
            url: fromEnv.SRC_CHAIN_RPC,
            createFork: fromEnv.SRC_CHAIN_CREATE_FORK,
            limitOrderProtocol: '0x0aa1A25F4AccAD28eF7069097f605149d4b5E025',
            wrappedNative: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // WETH on Sepolia
            ownerPrivateKey: '0x96fc8157b33348da998464a01a3d03b1f0e842103ddfa8d676cc79ea742bba63',
            tokens: {
                USDC: {
                    address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Sepolia USDC
                    donor: '0xd54F23BE482D9A58676590fCa79c8E43087f92fB'
                }
            }
        },
        destination: {
            chainId: 421614, // Arbitrum Sepolia testnet
            url: fromEnv.DST_CHAIN_RPC,
            createFork: fromEnv.DST_CHAIN_CREATE_FORK,
            limitOrderProtocol: '0x98A320BF204385A4508A043493D41118c8463f13',
            wrappedNative: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73', // WETH on Arbitrum Sepolia
            ownerPrivateKey: '0x96fc8157b33348da998464a01a3d03b1f0e842103ddfa8d676cc79ea742bba63',
            tokens: {
                USDC: {
                    address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // Arbitrum Sepolia USDC
                    donor: '0x62383739d68dd0f844103db8dfb05a7eded5bbe6'
                }
            }
        }
    }
} as const

export type ChainConfig = (typeof config.chain)['source' | 'destination']
