'use client'

import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { Wallet, Loader2, CheckCircle, AlertCircle, ArrowDownUp } from 'lucide-react'
import axios from 'axios'

// Type declaration for ethereum on window
declare global {
  interface Window {
    ethereum?: any
  }
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'

// ERC20 ABI for token interactions (including WETH)
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function deposit() external payable',
  'function withdraw(uint256 amount) external'
]

export default function SwapInterface() {
  const [account, setAccount] = useState<string>('')
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isSigning, setIsSigning] = useState(false)
  const [approvalStatus, setApprovalStatus] = useState<string>('')
  const [signatureStatus, setSignatureStatus] = useState<string>('')
  const [contracts, setContracts] = useState<any>(null)
  const [relayerAddress, setRelayerAddress] = useState<string>('')
  const [sepoliaBalance, setSepoliaBalance] = useState('0')
  const [allowance, setAllowance] = useState('0')
  const [monadBalance, setMonadBalance] = useState('0')

  // Switch to Monad testnet
  const switchToMonad = async () => {
    if (!provider) return
    
    try {
      await provider.send('wallet_switchEthereumChain', [{ chainId: '0x2797' }]) // Monad testnet
      console.log('✅ Switched to Monad testnet')
    } catch (error: any) {
      if (error.code === 4902) {
        // Chain not added, add it
        await provider.send('wallet_addEthereumChain', [{
          chainId: '0x2797',
          chainName: 'Monad Testnet',
          nativeCurrency: {
            name: 'MON',
            symbol: 'MON',
            decimals: 18
          },
          rpcUrls: ['https://rpc.testnet.monad.xyz'],
          blockExplorerUrls: ['https://explorer.testnet.monad.xyz']
        }])
      }
    }
  }

  // Connect wallet
  const connectWallet = async () => {
    if (typeof window.ethereum === 'undefined') {
      alert('Please install MetaMask!')
      return
    }

    setIsConnecting(true)
    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const accounts = await provider.send('eth_requestAccounts', [])
      const signer = await provider.getSigner()
      
      setProvider(provider)
      setSigner(signer)
      setAccount(accounts[0])

      // Add Monad testnet to MetaMask if not already added
      try {
        await provider.send('wallet_addEthereumChain', [{
          chainId: '0x2797', // 10143 in hex
          chainName: 'Monad Testnet',
          nativeCurrency: {
            name: 'MON',
            symbol: 'MON',
            decimals: 18
          },
          rpcUrls: ['https://rpc.testnet.monad.xyz'],
          blockExplorerUrls: ['https://explorer.testnet.monad.xyz']
        }])
      } catch (error: any) {
        // Chain might already be added, ignore error
        if (error.code !== 4001) {
          console.log('Monad testnet already added or user rejected')
        }
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error)
      alert('Failed to connect wallet')
    } finally {
      setIsConnecting(false)
    }
  }

  // Load contract addresses from backend
  const loadContracts = async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/contracts`)
      if (response.data.success) {
        setContracts(response.data.contracts)
        setRelayerAddress(response.data.relayerAddress)
      }
    } catch (error) {
      console.error('Failed to load contracts:', error)
    }
  }

  // Load balances and allowance
  const loadBalances = async () => {
    if (!provider || !account || !contracts || !relayerAddress) return

    try {
      // Switch to Sepolia for source balance
      await provider.send('wallet_switchEthereumChain', [{ chainId: '0xaa36a7' }]) // Sepolia
      
      const sepoliaProvider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_SEPOLIA_RPC || 'https://eth-sepolia.g.alchemy.com/v2/demo')
      // Use WETH token address on Sepolia
      const sepoliaWethAddress = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' // Sepolia WETH
      const sepoliaToken = new ethers.Contract(sepoliaWethAddress, ERC20_ABI, sepoliaProvider)
      
      // Get WETH balance
      const sepoliaBalance = await sepoliaToken.balanceOf(account)
      setSepoliaBalance(ethers.formatEther(sepoliaBalance)) // WETH uses 18 decimals

      // Check allowance (against relayer address since relayer transfers first)
      const allowance = await sepoliaToken.allowance(account, relayerAddress)
      setAllowance(ethers.formatEther(allowance)) // WETH uses 18 decimals

      // Load Monad balance (destination chain)
      const monadProvider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_MONAD_RPC || 'https://rpc.testnet.monad.xyz')
      const monadWethAddress = '0x59B993B49Cccc08c0fD418DcFfC6cA4d51F1339E' // Monad WETH
      const monadToken = new ethers.Contract(monadWethAddress, ERC20_ABI, monadProvider)
      
      // Get WETH balance on Monad
      const monadBalance = await monadToken.balanceOf(account)
      setMonadBalance(ethers.formatEther(monadBalance)) // WETH uses 18 decimals
    } catch (error) {
      console.error('Failed to load balances:', error)
    }
  }

  // Approve WETH tokens
  const approveTokens = async () => {
    if (!signer || !contracts) return

    setIsApproving(true)
    setApprovalStatus('Approving WETH...')
    
    try {
      // Ensure we're on Sepolia
      await provider?.send('wallet_switchEthereumChain', [{ chainId: '0xaa36a7' }])
      
      // Use WETH token address on Sepolia
      const tokenAddress = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' // Sepolia WETH
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer)
      const amountBN = ethers.parseEther('0.1') // WETH uses 18 decimals
      
      const tx = await tokenContract.approve(relayerAddress, amountBN)
      await tx.wait()
      
      setApprovalStatus('completed')
      console.log('✅ WETH approved successfully!')
      
      // Reload allowance
      await loadBalances()
    } catch (error: any) {
      console.error('Failed to approve tokens:', error)
      setApprovalStatus('error')
      alert(`Failed to approve tokens: ${error.message}`)
    } finally {
      setIsApproving(false)
    }
  }

  // Sign message for swap
  const signForSwap = async () => {
    if (!signer || !account || !contracts) return

    setIsSigning(true)
    setSignatureStatus('Creating order...')
    
    try {
      // Step 1: Create order and get signing data from backend
      const response = await axios.post(`${BACKEND_URL}/api/create-order`, {
        amount: 0.1,
        userAddress: account, // Use user's address as source address
        srcFactoryAddress: contracts.sepolia.escrowFactory,
        dstFactoryAddress: contracts.monad.escrowFactory
      })

      if (!response.data.success) {
        throw new Error(response.data.error)
      }

      const { typedData } = response.data
      setSignatureStatus('Signing message...')
      
      // Step 2: Sign the typed data
      const signature = await signer.signTypedData(
        typedData.domain,
        { CrossChainSwapOrder: typedData.types.CrossChainSwapOrder },
        typedData.message
      )

      setSignatureStatus('Submitting signature...')
      
      // Step 3: Submit signed message to backend
      const submitResponse = await axios.post(`${BACKEND_URL}/api/submit-signed-message`, {
        swapId: response.data.swapId,
        signature: signature,
        userAddress: account
      })

      if (submitResponse.data.success) {
        setSignatureStatus('completed')
        console.log('✅ Message signed and submitted successfully!')
      } else {
        throw new Error(submitResponse.data.error)
      }
      
    } catch (error: any) {
      console.error('Failed to sign message:', error)
      setSignatureStatus('error')
      alert(`Failed to sign message: ${error.response?.data?.error || error.message}`)
    } finally {
      setIsSigning(false)
    }
  }

  // Load contracts on component mount
  useEffect(() => {
    loadContracts()
  }, [])

  // Load balances when contracts, account and relayerAddress are available
  useEffect(() => {
    if (contracts && account && relayerAddress) {
      loadBalances()
    }
  }, [contracts, account, relayerAddress])

  const canApprove = account && contracts && !isApproving && approvalStatus !== 'completed'
  const canSign = account && contracts && approvalStatus === 'completed' && !isSigning && signatureStatus !== 'completed'

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h1 className="text-2xl font-bold text-center mb-6">Cross-Chain Swap</h1>
      <p className="text-center text-gray-600 mb-6">Sepolia WETH → Monad WETH Swap</p>

      {/* Wallet Connection */}
      {!account ? (
        <button
          onClick={connectWallet}
          disabled={isConnecting}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 mb-6"
        >
          {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      ) : (
        <div className="mb-6 p-3 bg-green-50 rounded-lg">
          <p className="text-sm text-green-800">
            Connected: {account.slice(0, 6)}...{account.slice(-4)}
          </p>
        </div>
      )}

      {/* Contract Status */}
      {!contracts && account && (
        <div className="mb-6 p-3 bg-yellow-50 rounded-lg">
          <div className="flex items-center gap-2 text-yellow-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading contracts...</span>
          </div>
        </div>
      )}

      {/* Balances */}
      {contracts && account && (
        <div className="mb-6 space-y-3">
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <span className="text-sm font-medium">Sepolia WETH</span>
            <span className="text-sm">{sepoliaBalance}</span>
          </div>
          <div className="flex justify-center">
            <ArrowDownUp className="w-4 h-4 text-gray-400" />
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <span className="text-sm font-medium">Monad WETH</span>
            <div className="flex items-center gap-2">
              <span className="text-sm">{monadBalance}</span>
              <button
                onClick={switchToMonad}
                className="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600"
              >
                View
              </button>
            </div>
          </div>
          {allowance !== '0' && (
            <div className="text-xs text-gray-500 text-center">
              Allowance: {allowance} WETH
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      {contracts && account && (
        <div className="space-y-4">
          {/* Approve Button */}
          {canApprove && (
            <button
              onClick={approveTokens}
              disabled={!canApprove}
              className="w-full flex items-center justify-center gap-2 bg-orange-600 text-white px-4 py-3 rounded-lg hover:bg-orange-700 disabled:opacity-50"
            >
              {isApproving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isApproving ? 'Approving...' : 'Approve 0.1 WETH'}
            </button>
          )}

          {/* Sign Button */}
          {canSign && (
            <button
              onClick={signForSwap}
              disabled={!canSign}
              className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-3 rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {isSigning ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isSigning ? 'Signing...' : 'Sign Message & Start Swap'}
            </button>
          )}

          {/* Status Display */}
          {approvalStatus && (
            <div className="p-3 rounded-lg">
              {approvalStatus === 'Approving WETH...' && (
                <div className="flex items-center gap-2 text-orange-600">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Please approve WETH in your wallet...</span>
                </div>
              )}
              {approvalStatus === 'completed' && (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  <span>WETH approved successfully!</span>
                </div>
              )}
              {approvalStatus === 'error' && (
                <div className="flex items-center gap-2 text-red-600">
                  <AlertCircle className="w-4 h-4" />
                  <span>Error occurred during approval</span>
                </div>
              )}
            </div>
          )}

          {signatureStatus && (
            <div className="p-3 rounded-lg">
              {signatureStatus === 'Creating order...' && (
                <div className="flex items-center gap-2 text-blue-600">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating order...</span>
                </div>
              )}
              {signatureStatus === 'Signing message...' && (
                <div className="flex items-center gap-2 text-yellow-600">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Please sign the message in your wallet...</span>
                </div>
              )}
              {signatureStatus === 'Submitting signature...' && (
                <div className="flex items-center gap-2 text-blue-600">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Submitting signature...</span>
                </div>
              )}
              {signatureStatus === 'completed' && (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  <span>Message signed and submitted successfully!</span>
                </div>
              )}
              {signatureStatus === 'error' && (
                <div className="flex items-center gap-2 text-red-600">
                  <AlertCircle className="w-4 h-4" />
                  <span>Error occurred during signing</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      {!account && (
        <div className="mt-6 p-4 bg-yellow-50 rounded-lg">
          <h3 className="font-medium text-yellow-800 mb-2">How it works:</h3>
          <ol className="text-sm text-yellow-700 space-y-1 list-decimal list-inside">
            <li>Connect your wallet</li>
            <li>Approve 0.1 WETH on Sepolia</li>
            <li>Sign the swap message</li>
            <li>Backend executes cross-chain swap</li>
            <li>Receive WETH on Monad testnet</li>
          </ol>
        </div>
      )}

      {/* Success Message */}
      {signatureStatus === 'completed' && (
        <div className="mt-6 p-4 bg-green-50 rounded-lg">
          <h3 className="font-medium text-green-800 mb-2">✅ Success!</h3>
          <p className="text-sm text-green-700">
            Your message has been signed and submitted. The backend will now execute the cross-chain swap automatically.
          </p>
        </div>
      )}
    </div>
  )
} 