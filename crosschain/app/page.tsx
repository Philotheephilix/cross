import SwapInterface from './components/SwapInterface'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Cross-Chain Swap Interface
          </h1>
          <p className="text-xl text-gray-600 mb-2">
            Seamless USDC swaps between Sepolia and Arbitrum Sepolia
          </p>
          <p className="text-sm text-gray-500">
            Powered by 1inch Fusion+ technology with automated relayer service
          </p>
        </div>

        <div className="flex justify-center">
          <SwapInterface />
        </div>

        <div className="mt-16 grid md:grid-cols-3 gap-8 text-center">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="font-semibold text-lg mb-2">🔐 Secure</h3>
            <p className="text-gray-600 text-sm">
              HTLC-based atomic swaps ensure your funds are always safe
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="font-semibold text-lg mb-2">⚡ Fast</h3>
            <p className="text-gray-600 text-sm">
              Automated relayer service handles all cross-chain operations
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="font-semibold text-lg mb-2">💰 Low Cost</h3>
            <p className="text-gray-600 text-sm">
              Only pay gas for approval and signing - relayer covers the rest
            </p>
          </div>
        </div>

        <div className="mt-12 text-center">
          <div className="bg-white p-6 rounded-lg shadow-sm max-w-2xl mx-auto">
            <h3 className="font-semibold text-lg mb-4">How It Works</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold mb-2">1</div>
                <p>Connect Wallet</p>
              </div>
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold mb-2">2</div>
                <p>Approve USDC</p>
              </div>
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold mb-2">3</div>
                <p>Sign Order</p>
              </div>
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold mb-2">4</div>
                <p>Relayer Executes</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
