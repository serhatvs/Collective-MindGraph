import {
  MAX_NODES_PER_STREAM,
  computeSnapshotHash,
  type CommitSkippedReason,
  type SnapshotReason,
  type StreamDetail
} from "@cmg/shared";

import type { DatabaseClient } from "../db/client.js";
import { AppError, assert } from "../lib/errors.js";
import type { ChainService } from "./chainService.js";

interface CommitResult {
  committed: boolean;
  skippedReason?: CommitSkippedReason;
  snapshot?: {
    streamId: string;
    snapshotIndex: number;
    snapshotHash: string;
    reason: SnapshotReason;
    txHash: string;
    createdAt: string;
  };
  stream: StreamDetail["stream"];
}

export class SnapshotService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly chainService: ChainService
  ) {}

  getStreamDetail(streamId: string): StreamDetail {
    const stream = this.db.getStream(streamId);
    assert(stream, new AppError(404, "STREAM_NOT_FOUND", "Stream not found."));

    const nodes = this.db.getNodes(streamId);
    const snapshots = this.db.getSnapshots(streamId);
    const ai = this.db.getAiSummary(streamId);

    return {
      stream,
      nodes,
      snapshots,
      limits: {
        maxNodes: MAX_NODES_PER_STREAM,
        nodeCount: nodes.length,
        canAddNode: stream.status === "active" && nodes.length < MAX_NODES_PER_STREAM
      },
      ai
    };
  }

  async commit(streamId: string, reason: SnapshotReason): Promise<CommitResult> {
    const stream = this.db.getStream(streamId);
    assert(stream, new AppError(404, "STREAM_NOT_FOUND", "Stream not found."));

    if (stream.status === "ended") {
      throw new AppError(409, "STREAM_ENDED", "The stream has already ended.");
    }

    const blockingReason = this.db.getBlockingCommitReason(streamId);
    if (blockingReason) {
      if (reason === "auto") {
        return {
          committed: false,
          skippedReason: blockingReason,
          stream
        };
      }

      throw new AppError(
        409,
        "AI_ENRICHMENT_BLOCKING_COMMIT",
        "AI enrichment must complete or be manually accepted before committing."
      );
    }

    const nodes = this.db.getNodes(streamId);
    if (nodes.length === 0) {
      if (reason === "final") {
        const endedAt = new Date().toISOString();
        this.db.endStream(streamId, endedAt);
        const endedStream = this.db.getStream(streamId);
        assert(endedStream, new AppError(404, "STREAM_NOT_FOUND", "Stream not found."));

        return {
          committed: false,
          skippedReason: "no_nodes",
          stream: endedStream
        };
      }

      return {
        committed: false,
        skippedReason: "no_nodes",
        stream
      };
    }

    const snapshotHash = computeSnapshotHash(nodes);
    if (reason === "auto" && stream.lastSnapshotHash === snapshotHash) {
      return {
        committed: false,
        skippedReason: "no_changes",
        stream
      };
    }

    const snapshotIndex = stream.lastSnapshotIndex + 1;
    const { txHash } = await this.chainService.commitSnapshot(streamId, snapshotIndex, snapshotHash);
    const createdAt = new Date().toISOString();
    const snapshot = {
      streamId,
      snapshotIndex,
      snapshotHash,
      reason,
      txHash,
      createdAt
    };

    this.db.insertSnapshot(snapshot);
    this.db.updateStreamSnapshot(streamId, snapshotIndex, snapshotHash);

    if (reason === "final") {
      this.db.endStream(streamId, createdAt);
    }

    const updatedStream = this.db.getStream(streamId);
    assert(updatedStream, new AppError(404, "STREAM_NOT_FOUND", "Stream not found."));

    return {
      committed: true,
      snapshot,
      stream: updatedStream
    };
  }
}
