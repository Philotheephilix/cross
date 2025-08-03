require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    monadTestnet: {
      url: "https://monad-testnet.g.alchemy.com/v2/oJTjnNCsJEOqYv3MMtrtT6LUFhwcW9pR",
      chainId: 10143,
      accounts: ["0xf1fa5583f8fb6c0e1d3b82ee7bb81bead1935285cef5a5054594ca727a45ebc1"], // Private key from config
      timeout: 60000,
    },
  },
};
