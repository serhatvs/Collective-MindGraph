import { config as loadEnv } from "dotenv";

import hre from "hardhat";

loadEnv({ path: "../.env" });
loadEnv();

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error("CONTRACT_ADDRESS is required for the smoke test.");
  }

  const contract = await hre.ethers.getContractAt("CollectiveMindGraph", contractAddress);
  const metadata = `smoke-${new Date().toISOString()}`;

  const createTx = await contract.createStream(metadata);
  const createReceipt = await createTx.wait();
  if (!createReceipt || createReceipt.status !== 1) {
    throw new Error("createStream transaction did not succeed.");
  }

  const streamCreatedLog = createReceipt.logs
    .map((log) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((log) => log?.name === "StreamCreated");

  const streamId = streamCreatedLog?.args.streamId;
  if (streamId === undefined) {
    throw new Error("StreamCreated event not found in the createStream receipt.");
  }

  const snapshotHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`smoke-${streamId.toString()}-${Date.now()}`));
  const commitTx = await contract.commitSnapshot(streamId, 1n, snapshotHash);
  const commitReceipt = await commitTx.wait();
  if (!commitReceipt || commitReceipt.status !== 1) {
    throw new Error("commitSnapshot transaction did not succeed.");
  }

  const lastSnapshotIndex = await contract.lastSnapshotIndex(streamId);
  if (lastSnapshotIndex !== 1n) {
    throw new Error(`Expected lastSnapshotIndex to be 1, received ${lastSnapshotIndex.toString()}.`);
  }

  console.log(`Smoke test passed for contract ${contractAddress}`);
  console.log(`streamId: ${streamId.toString()}`);
  console.log(`createStream tx: ${createTx.hash}`);
  console.log(`commitSnapshot tx: ${commitTx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
