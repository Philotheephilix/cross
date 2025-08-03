import { ethers } from 'ethers'

// Custom SDK replacement for 1inch cross-chain functionality
export class CustomSDK {
    // Address wrapper similar to SDK
    static Address = {
        fromBigInt: (value) => {
            return `0x${value.toString(16).padStart(40, '0')}`
        },
        fromString: (value) => {
            return value.toLowerCase()
        }
    }

    // HashLock functionality
    static HashLock = {
        // Hash a secret to create a hashlock
        hashSecret: (secret) => {
            return ethers.keccak256(ethers.toUtf8Bytes(secret))
        },

        // Create hashlock for single fill
        forSingleFill: (secret) => {
            return this.HashLock.hashSecret(secret)
        },

        // Create hashlock for multiple fills using Merkle tree
        forMultipleFills: (leaves) => {
            if (leaves.length === 0) throw new Error('Leaves cannot be empty')
            if (leaves.length === 1) return leaves[0]
            
            // Build Merkle tree and return root
            return this.buildMerkleRoot(leaves)
        },

        // Get Merkle leaves from secrets
        getMerkleLeaves: (secrets) => {
            return secrets.map(secret => this.HashLock.hashSecret(secret))
        },

        // Get Merkle proof for a specific index
        getProof: (leaves, index) => {
            return this.getMerkleProof(leaves, index)
        }
    }

    // TimeLocks functionality
    static TimeLocks = {
        new: (params) => {
            // Pack timelocks into a single uint256
            // Format: [deployedAt(32)][dstCancellation(32)][dstPublicWithdrawal(32)][dstWithdrawal(32)][srcPublicCancellation(32)][srcCancellation(32)][srcPublicWithdrawal(32)][srcWithdrawal(32)]
            let packed = 0n
            
            packed |= BigInt(params.srcWithdrawal) & 0xFFFFFFFFn
            packed |= (BigInt(params.srcPublicWithdrawal) & 0xFFFFFFFFn) << 32n
            packed |= (BigInt(params.srcCancellation) & 0xFFFFFFFFn) << 64n
            packed |= (BigInt(params.srcPublicCancellation) & 0xFFFFFFFFn) << 96n
            packed |= (BigInt(params.dstWithdrawal) & 0xFFFFFFFFn) << 128n
            packed |= (BigInt(params.dstPublicWithdrawal) & 0xFFFFFFFFn) << 160n
            packed |= (BigInt(params.dstCancellation) & 0xFFFFFFFFn) << 192n
            
            return packed
        },

        fromBigInt: (value) => {
            return value
        }
    }

    // AuctionDetails functionality
    static AuctionDetails = class {
        constructor(params) {
            this.initialRateBump = params.initialRateBump
            this.points = params.points
            this.duration = params.duration
            this.startTime = params.startTime
        }

        // Encode auction details for contract interaction
        encode() {
            // Simple encoding for now - can be expanded based on actual contract requirements
            return ethers.solidityPacked(
                ['uint256', 'uint256', 'uint256'],
                [this.initialRateBump, this.duration, this.startTime]
            )
        }
    }

    // TakerTraits functionality
    static TakerTraits = {
        new: () => {
            return new this.TakerTraitsClass()
        }
    }

    static TakerTraitsClass = class {
        constructor() {
            this.extension = null
            this.interaction = null
            this.amountMode = null
            this.amountThreshold = 0n
        }

        setExtension(extension) {
            this.extension = extension
            return this
        }

        setInteraction(interaction) {
            this.interaction = interaction
            return this
        }

        setAmountMode(mode) {
            this.amountMode = mode
            return this
        }

        setAmountThreshold(threshold) {
            this.amountThreshold = threshold
            return this
        }

        encode() {
            // Encode taker traits for contract interaction
            return ethers.solidityPacked(
                ['uint256', 'uint256'],
                [this.amountMode || 0, this.amountThreshold]
            )
        }
    }

    // AmountMode constants
    static AmountMode = {
        EXACT: 0,
        MINIMUM: 1,
        MAXIMUM: 2
    }

    // CrossChainOrder functionality
    static CrossChainOrder = {
        new: (escrowFactory, orderParams, orderFlags) => {
            return new this.CrossChainOrderClass(escrowFactory, orderParams, orderFlags)
        }
    }

    static CrossChainOrderClass = class {
        constructor(escrowFactory, orderParams, orderFlags) {
            this.escrowFactory = escrowFactory
            this.orderParams = orderParams
            this.escrowParams = null
            this.extensionParams = null
            this.orderFlags = orderFlags
            this.makingAmount = orderParams.makingAmount
            this.takingAmount = orderParams.takingAmount
            this.extension = null
        }

        getOrderHash(chainId) {
            // Create order hash based on order parameters
            const orderData = ethers.solidityPacked(
                ['address', 'uint256', 'uint256', 'address', 'address', 'uint256'],
                [
                    this.escrowFactory,
                    this.orderParams.salt,
                    this.orderParams.nonce,
                    this.orderParams.maker,
                    this.orderParams.makerAsset,
                    this.makingAmount
                ]
            )
            return ethers.keccak256(orderData)
        }

        toSrcImmutables(chainId, taker, amount, hashLock) {
            const orderHash = this.getOrderHash(chainId)
            const timelocks = CustomSDK.TimeLocks.new({
                srcWithdrawal: 0n,
                srcPublicWithdrawal: 0n,
                srcCancellation: 0n,
                srcPublicCancellation: 0n,
                dstWithdrawal: 0n,
                dstPublicWithdrawal: 0n,
                dstCancellation: 0n
            })

            return {
                orderHash,
                hashlock: hashLock,
                maker: this.orderParams.maker,
                taker,
                token: this.orderParams.makerAsset,
                amount,
                safetyDeposit: 0n,
                timelocks
            }
        }

        build() {
            // Build the order structure for the Resolver's deploySrc function
            // Based on IOrderMixin.Order structure
            return {
                salt: this.orderParams.salt,
                maker: BigInt(this.orderParams.maker), // Address type wraps uint256
                receiver: BigInt(0), // Use maker as receiver for now
                makerAsset: BigInt(this.orderParams.makerAsset), // Address type wraps uint256
                takerAsset: BigInt(this.orderParams.takerAsset), // Address type wraps uint256
                makingAmount: this.orderParams.makingAmount,
                takingAmount: this.orderParams.takingAmount,
                makerTraits: 0n // Default maker traits
            }
        }
    }

    // EscrowFactory functionality
    static EscrowFactory = class {
        constructor(factoryAddress) {
            this.factoryAddress = factoryAddress
        }

        getSrcEscrowAddress(immutables, implementation) {
            const salt = this.hashImmutables(immutables)
            return this.computeCreate2Address(this.factoryAddress, salt, implementation)
        }

        getDstEscrowAddress(immutables, complement, deployedAt, taker, implementation) {
            const salt = this.hashImmutables({
                ...immutables,
                taker,
                deployedAt
            })
            return this.computeCreate2Address(this.factoryAddress, salt, implementation)
        }

        getMultipleFillInteraction(proof, index, secretHash) {
            // Encode multiple fill interaction data
            return ethers.solidityPacked(
                ['bytes32[]', 'uint256', 'bytes32'],
                [proof, index, secretHash]
            )
        }

        hashImmutables(immutables) {
            return ethers.keccak256(ethers.solidityPacked(
                ['bytes32', 'bytes32', 'address', 'address', 'address', 'uint256', 'uint256', 'uint256'],
                [
                    immutables.orderHash,
                    immutables.hashlock,
                    immutables.maker,
                    immutables.taker,
                    immutables.token,
                    immutables.amount,
                    immutables.safetyDeposit,
                    immutables.timelocks
                ]
            ))
        }

        setDeployedAt(timelocks, deployedAt) {
            // Set deployedAt in timelocks
            return (timelocks & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00000000n) | BigInt(deployedAt)
        }

        computeCreate2Address(factory, salt, implementation) {
            const initCodeHash = ethers.keccak256(ethers.solidityPacked(
                ['bytes', 'bytes32', 'bytes'],
                ['0x3d602d80600a3d3981f3363d3d373d3d3d363d73', implementation, '0x5af43d82803e903d91602b57fd5bf3']
            ))
            
            const combinedHash = ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [salt, initCodeHash]))
            return ethers.getCreateAddress({
                from: factory,
                nonce: combinedHash
            })
        }
    }

    // Utility function to generate random bigint
    static randBigInt(max) {
        return BigInt(Math.floor(Math.random() * Number(max)))
    }

    // Private helper methods
    static buildMerkleRoot(leaves) {
        if (leaves.length === 1) return leaves[0]
        
        const newLeaves = []
        for (let i = 0; i < leaves.length; i += 2) {
            if (i + 1 < leaves.length) {
                newLeaves.push(ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [leaves[i], leaves[i + 1]])))
            } else {
                newLeaves.push(leaves[i])
            }
        }
        
        return this.buildMerkleRoot(newLeaves)
    }

    static getMerkleProof(leaves, index) {
        if (leaves.length === 1) return []
        
        const proof = []
        const newLeaves = []
        let newIndex = Math.floor(index / 2)
        
        for (let i = 0; i < leaves.length; i += 2) {
            if (i + 1 < leaves.length) {
                const left = leaves[i]
                const right = leaves[i + 1]
                const combined = ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [left, right]))
                newLeaves.push(combined)
                
                if (i === index) {
                    proof.push(right)
                } else if (i + 1 === index) {
                    proof.push(left)
                }
            } else {
                newLeaves.push(leaves[i])
            }
        }
        
        return proof.concat(this.getMerkleProof(newLeaves, newIndex))
    }
} 