const hre = require("hardhat");

async function main() {
  console.log("💰 Checking account balance on Monad testnet...");

  const [signer] = await hre.ethers.getSigners();
  console.log(`📋 Account address: ${signer.address}`);

  const balance = await hre.ethers.provider.getBalance(signer.address);
  console.log(`📊 Balance: ${hre.ethers.formatEther(balance)} MON`);

  if (balance === 0n) {
    console.log("❌ No balance found. Please get testnet MON from:");
    console.log("   https://faucet.testnet.monad.xyz/");
  } else {
    console.log("✅ Account has sufficient balance for deployment");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 