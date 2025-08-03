const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying LimitOrderProtocol to Arbitrum Sepolia...");

  // Deploy LimitOrderProtocol
  const LimitOrderProtocol = await hre.ethers.getContractFactory("LimitOrderProtocol");
  const limitOrderProtocol = await LimitOrderProtocol.deploy();
  await limitOrderProtocol.waitForDeployment();

  const limitOrderProtocolAddress = await limitOrderProtocol.getAddress();
  console.log(`✅ LimitOrderProtocol deployed to: ${limitOrderProtocolAddress}`);

  // Get the deployer address
  const [deployer] = await hre.ethers.getSigners();
  console.log(`📋 Deployer address: ${deployer.address}`);

  console.log("\n📋 Deployment Summary:");
  console.log(`   LimitOrderProtocol: ${limitOrderProtocolAddress}`);
  console.log(`   Deployer: ${deployer.address}`);
  console.log(`   Network: Arbitrum Sepolia (Chain ID: 421614)`);
  console.log(`   Explorer: https://sepolia.arbiscan.io/address/${limitOrderProtocolAddress}`);

  // Save deployment info to a file
  const deploymentInfo = {
    network: "Arbitrum Sepolia",
    chainId: 421614,
    limitOrderProtocol: limitOrderProtocolAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    explorer: `https://sepolia.arbiscan.io/address/${limitOrderProtocolAddress}`
  };

  const fs = require('fs');
  fs.writeFileSync('arbitrum-limit-order-deployment.json', JSON.stringify(deploymentInfo, null, 2));
  console.log(`💾 Deployment info saved to: arbitrum-limit-order-deployment.json`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 