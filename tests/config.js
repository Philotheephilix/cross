import { z } from 'zod'
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
                WETH: {
                    address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // WETH on Sepolia
                    donor: '0x0000000000000000000000000000000000000000' // Will be set when available
                },
                USDC: {
                    address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Sepolia USDC
                    donor: '0xd54F23BE482D9A58676590fCa79c8E43087f92fB'
                }
            }
        },
        destination: {
            chainId: 10143, // Monad testnet
            url: fromEnv.DST_CHAIN_RPC,
            createFork: fromEnv.DST_CHAIN_CREATE_FORK,
            limitOrderProtocol: '0x4aA294c0B461B454188053a7F055be5807f212B4', // Will need to deploy on Monad
            wrappedNative: '0x59B993B49Cccc08c0fD418DcFfC6cA4d51F1339E', // WETH on Monad testnet
            ownerPrivateKey: '0x96fc8157b33348da998464a01a3d03b1f0e842103ddfa8d676cc79ea742bba63',
            tokens: {
                WETH: {
                    address: '0x59B993B49Cccc08c0fD418DcFfC6cA4d51F1339E', // WETH on Monad testnet
                    donor: '0x0000000000000000000000000000000000000000' // Will be set when available
                },
                USDC: {
                    address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // Keeping for compatibility
                    donor: '0x62383739d68dd0f844103db8dfb05a7eded5bbe6'
                }
            }
        }
    }
} 