import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { ethers } from "hardhat";

describe("CollectiveMindGraph", () => {
  async function deployFixture() {
    const factory = await ethers.getContractFactory("CollectiveMindGraph");
    const contract = await factory.deploy();

    return { contract };
  }

  it("creates streams sequentially", async () => {
    const { contract } = await deployFixture();
    const [signer] = await ethers.getSigners();

    await expect(contract.createStream("demo"))
      .to.emit(contract, "StreamCreated")
      .withArgs(1n, signer.address, "demo");

    await contract.createStream("demo-2");
    expect(await contract.nextStreamId()).to.equal(3n);
  });

  it("commits snapshots for an existing stream", async () => {
    const { contract } = await deployFixture();
    const [signer] = await ethers.getSigners();
    const snapshotHash = ethers.keccak256(ethers.toUtf8Bytes("graph"));

    await contract.createStream("demo");

    await expect(contract.commitSnapshot(1n, 1n, snapshotHash))
      .to.emit(contract, "SnapshotCommitted")
      .withArgs(1n, 1n, snapshotHash, signer.address, anyValue);
  });

  it("rejects commits for missing streams", async () => {
    const { contract } = await deployFixture();

    await expect(contract.commitSnapshot(999n, 1n, ethers.ZeroHash))
      .to.be.revertedWithCustomError(contract, "StreamNotFound")
      .withArgs(999n);
  });

  it("rejects non-monotonic snapshot indexes", async () => {
    const { contract } = await deployFixture();
    await contract.createStream("demo");
    await contract.commitSnapshot(1n, 1n, ethers.ZeroHash);

    await expect(contract.commitSnapshot(1n, 1n, ethers.ZeroHash))
      .to.be.revertedWithCustomError(contract, "InvalidSnapshotIndex")
      .withArgs(2n, 1n);
  });
});
