import { collectiveMindGraphAbi, DEFAULT_STREAM_METADATA } from "@cmg/shared";
import { createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { AppError } from "../lib/errors.js";

export interface ChainService {
  createStream(metadata?: string): Promise<{ streamId: string; txHash: string }>;
  commitSnapshot(streamId: string, snapshotIndex: number, snapshotHash: string): Promise<{ txHash: string }>;
}

interface ChainServiceOptions {
  rpcUrl: string;
  privateKey: `0x${string}`;
  contractAddress: `0x${string}`;
}

export function createChainService(options: ChainServiceOptions): ChainService {
  const account = privateKeyToAccount(options.privateKey);
  const transport = http(options.rpcUrl);
  const publicClient = createPublicClient({ transport });
  const walletClient = createWalletClient({ account, transport });

  return {
    async createStream(metadata = DEFAULT_STREAM_METADATA) {
      try {
        const txHash = await walletClient.writeContract({
          address: options.contractAddress,
          abi: collectiveMindGraphAbi,
          account,
          chain: undefined,
          functionName: "createStream",
          args: [metadata]
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        const [event] = parseEventLogs({
          abi: collectiveMindGraphAbi,
          logs: receipt.logs,
          eventName: "StreamCreated"
        });

        const streamId = event?.args.streamId;
        if (streamId === undefined) {
          throw new Error("StreamCreated event not found");
        }

        return {
          streamId: streamId.toString(),
          txHash
        };
      } catch (error) {
        throw new AppError(502, "CHAIN_CREATE_STREAM_FAILED", "Failed to create stream on-chain", error);
      }
    },
    async commitSnapshot(streamId: string, snapshotIndex: number, snapshotHash: string) {
      try {
        const txHash = await walletClient.writeContract({
          address: options.contractAddress,
          abi: collectiveMindGraphAbi,
          account,
          chain: undefined,
          functionName: "commitSnapshot",
          args: [BigInt(streamId), BigInt(snapshotIndex), snapshotHash as `0x${string}`]
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash });

        return { txHash };
      } catch (error) {
        throw new AppError(502, "CHAIN_COMMIT_FAILED", "Failed to commit snapshot on-chain", error);
      }
    }
  };
}
