import { config as loadEnv } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import hre from "hardhat";

loadEnv({ path: "../.env" });
loadEnv();

async function main() {
  const contractFactory = await hre.ethers.getContractFactory("CollectiveMindGraph");
  const contract = await contractFactory.deploy();
  await contract.waitForDeployment();
  const deploymentTransaction = contract.deploymentTransaction();
  if (!deploymentTransaction) {
    throw new Error("Deployment transaction is unavailable.");
  }

  const address = await contract.getAddress();
  const network = await hre.ethers.provider.getNetwork();

  const deploymentRecord = {
    address,
    txHash: deploymentTransaction.hash,
    chainId: Number(network.chainId),
    deployedAt: new Date().toISOString()
  };

  mkdirSync("deployments", { recursive: true });
  writeFileSync(join("deployments", "latest.json"), `${JSON.stringify(deploymentRecord, null, 2)}\n`);
  syncDeploymentToRootEnv(address, deploymentTransaction.hash);

  console.log(`CollectiveMindGraph deployed to ${address}`);
  console.log(`Deployment tx hash: ${deploymentTransaction.hash}`);
}

function syncDeploymentToRootEnv(address: string, txHash: string) {
  const envPath = join("..", ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const current = readFileSync(envPath, "utf8");
  const next = upsertEnvValue(
    upsertEnvValue(
      upsertEnvValue(current, "CONTRACT_ADDRESS", address),
      "CONTRACT_DEPLOY_TX_HASH",
      txHash
    ),
    "DATABASE_PATH",
    getDatabasePathForAddress(address)
  );

  writeFileSync(envPath, next);
}

function upsertEnvValue(source: string, key: string, value: string) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(source)) {
    return source.replace(pattern, `${key}=${value}`);
  }

  return `${source.trimEnd()}\n${key}=${value}\n`;
}

function getDatabasePathForAddress(address: string) {
  return `./data/collective-mindgraph-${address.toLowerCase()}.sqlite`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
