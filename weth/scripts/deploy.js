const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying WETH contract to Monad testnet...");

  const WETH = await hre.ethers.getContractFactory("WETH");
  const weth = await WETH.deploy();
  await weth.waitForDeployment();

  const wethAddress = await weth.getAddress();
  console.log(`✅ WETH deployed to: ${wethAddress}`);

  // Get the deployer address
  const [deployer] = await hre.ethers.getSigners();
  console.log(`📋 Deployer address: ${deployer.address}`);

  // Mint some WETH to the deployer for testing
  const mintAmount = hre.ethers.parseEther("100"); // 100 WETH
  console.log(`💰 Minting ${hre.ethers.formatEther(mintAmount)} WETH to deployer...`);
  
  const mintTx = await weth.mint(deployer.address, mintAmount);
  await mintTx.wait();
  
  console.log(`✅ Minted ${hre.ethers.formatEther(mintAmount)} WETH to ${deployer.address}`);

  // Check balance
  const balance = await weth.balanceOf(deployer.address);
  console.log(`📊 Deployer WETH balance: ${hre.ethers.formatEther(balance)} WETH`);

  console.log("\n📋 Deployment Summary:");
  console.log(`   WETH Contract: ${wethAddress}`);
  console.log(`   Deployer: ${deployer.address}`);
  console.log(`   Initial Balance: ${hre.ethers.formatEther(balance)} WETH`);
  console.log(`   Network: Monad Testnet (Chain ID: 10143)`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 