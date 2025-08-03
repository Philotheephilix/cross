// Utility functions for cross-chain operations

export const UINT_40_MAX = 0xFFFFFFFFFFn

export function uint8ArrayToHex(bytes) {
    return '0x' + Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

export function randomBytes(length) {
    const bytes = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        bytes[i] = Math.floor(Math.random() * 256)
    }
    return bytes
} 