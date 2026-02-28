export const collectiveMindGraphAbi = [
  {
    type: "function",
    name: "createStream",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "metadata",
        type: "string"
      }
    ],
    outputs: [
      {
        name: "streamId",
        type: "uint256"
      }
    ]
  },
  {
    type: "function",
    name: "commitSnapshot",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "streamId",
        type: "uint256"
      },
      {
        name: "snapshotIndex",
        type: "uint256"
      },
      {
        name: "snapshotHash",
        type: "bytes32"
      }
    ],
    outputs: []
  },
  {
    type: "event",
    name: "StreamCreated",
    anonymous: false,
    inputs: [
      {
        indexed: true,
        name: "streamId",
        type: "uint256"
      },
      {
        indexed: true,
        name: "creator",
        type: "address"
      },
      {
        indexed: false,
        name: "metadata",
        type: "string"
      }
    ]
  },
  {
    type: "event",
    name: "SnapshotCommitted",
    anonymous: false,
    inputs: [
      {
        indexed: true,
        name: "streamId",
        type: "uint256"
      },
      {
        indexed: true,
        name: "snapshotIndex",
        type: "uint256"
      },
      {
        indexed: false,
        name: "snapshotHash",
        type: "bytes32"
      },
      {
        indexed: true,
        name: "committer",
        type: "address"
      },
      {
        indexed: false,
        name: "timestamp",
        type: "uint256"
      }
    ]
  }
] as const;

