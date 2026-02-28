// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract CollectiveMindGraph {
    error StreamNotFound(uint256 streamId);
    error InvalidSnapshotIndex(uint256 expected, uint256 received);

    uint256 public nextStreamId = 1;

    mapping(uint256 => bool) public streamExists;
    mapping(uint256 => uint256) public lastSnapshotIndex;

    event StreamCreated(uint256 indexed streamId, address indexed creator, string metadata);
    event SnapshotCommitted(
        uint256 indexed streamId,
        uint256 indexed snapshotIndex,
        bytes32 snapshotHash,
        address indexed committer,
        uint256 timestamp
    );

    function createStream(string calldata metadata) external returns (uint256 streamId) {
        streamId = nextStreamId;
        nextStreamId += 1;

        streamExists[streamId] = true;

        emit StreamCreated(streamId, msg.sender, metadata);
    }

    function commitSnapshot(uint256 streamId, uint256 snapshotIndex, bytes32 snapshotHash) external {
        if (!streamExists[streamId]) {
            revert StreamNotFound(streamId);
        }

        uint256 expectedIndex = lastSnapshotIndex[streamId] + 1;
        if (snapshotIndex != expectedIndex) {
            revert InvalidSnapshotIndex(expectedIndex, snapshotIndex);
        }

        lastSnapshotIndex[streamId] = snapshotIndex;

        emit SnapshotCommitted(streamId, snapshotIndex, snapshotHash, msg.sender, block.timestamp);
    }
}

