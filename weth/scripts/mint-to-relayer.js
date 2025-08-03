const hre = require("hardhat");

async function main() {
  console.log("💰 Minting WETH to relayer address...");

  // Relayer address from the backend config
  const relayerAddress = "0x2559284bC8fD9Ca6235AF2379A4D9C4B2Ade4cCa";
  
  // Newly deployed WETH contract address
  const wethAddress = "0x59B993B49Cccc08c0fD418DcFfC6cA4d51F1339E";
  
  console.log(`📋 Relayer address: ${relayerAddress}`);
  console.log(`📋 WETH contract: ${wethAddress}`);

  const WETH = await hre.ethers.getContractAt("WETH", wethAddress);
  
  // Mint 10 WETH to the relayer
  const mintAmount = hre.ethers.parseEther("10"); // 10 WETH
  console.log(`💰 Minting ${hre.ethers.formatEther(mintAmount)} WETH to relayer...`);
  
  const mintTx = await WETH.mint(relayerAddress, mintAmount);
  await mintTx.wait();
  
  console.log(`✅ Minted ${hre.ethers.formatEther(mintAmount)} WETH to ${relayerAddress}`);

  // Check relayer balance
  const balance = await WETH.balanceOf(relayerAddress);
  console.log(`📊 Relayer WETH balance: ${hre.ethers.formatEther(balance)} WETH`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 