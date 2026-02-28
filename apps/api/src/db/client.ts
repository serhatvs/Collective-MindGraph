import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  AiStatus,
  BranchType,
  CommitSkippedReason,
  EnrichmentJobRecord,
  EnrichmentJobStatus,
  NodeRecord,
  PlacementSource,
  SnapshotRecord,
  StreamRecord,
  StreamStatus
} from "@cmg/shared";

import { schemaSql } from "./schema.js";

type StreamRow = {
  id: string;
  metadata: string | null;
  status: StreamStatus;
  created_at: string;
  ended_at: string | null;
  created_tx_hash: string;
  last_snapshot_index: number;
  last_snapshot_hash: string | null;
};

type NodeRow = {
  node_id: number;
  stream_id: string;
  text: string;
  timestamp: string;
  parent_id: number | null;
  branch_type: BranchType;
  suggested_score: number | null;
  suggested_parent_id: number | null;
  suggested_branch_type: BranchType;
  classification: NodeRecord["classification"];
  ai_status: AiStatus;
  placement_source: PlacementSource;
  heuristic_parent_id: number | null;
  heuristic_branch_type: BranchType;
  heuristic_score: number;
  ai_rationale: string | null;
  ai_model: string | null;
};

type SnapshotRow = {
  stream_id: string;
  snapshot_index: number;
  snapshot_hash: string;
  reason: SnapshotRecord["reason"];
  tx_hash: string;
  created_at: string;
};

type EnrichmentJobRow = {
  stream_id: string;
  node_id: number;
  status: EnrichmentJobStatus;
  attempt_count: number;
  next_attempt_at: string;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
};

type AiSummaryRow = {
  ai_status: AiStatus;
  count: number;
};

function mapStream(row: StreamRow): StreamRecord {
  return {
    id: row.id,
    metadata: row.metadata,
    status: row.status,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    createdTxHash: row.created_tx_hash,
    lastSnapshotIndex: row.last_snapshot_index,
    lastSnapshotHash: row.last_snapshot_hash
  };
}

function mapNode(row: NodeRow): NodeRecord {
  return {
    nodeId: row.node_id,
    streamId: row.stream_id,
    text: row.text,
    timestamp: row.timestamp,
    parentId: row.parent_id,
    branchType: row.branch_type,
    suggestedScore: row.suggested_score,
    suggestedParentId: row.suggested_parent_id,
    suggestedBranchType: row.suggested_branch_type,
    classification: row.classification,
    aiStatus: row.ai_status,
    placementSource: row.placement_source,
    heuristicParentId: row.heuristic_parent_id,
    heuristicBranchType: row.heuristic_branch_type,
    heuristicScore: row.heuristic_score,
    aiRationale: row.ai_rationale,
    aiModel: row.ai_model
  };
}

function mapSnapshot(row: SnapshotRow): SnapshotRecord {
  return {
    streamId: row.stream_id,
    snapshotIndex: row.snapshot_index,
    snapshotHash: row.snapshot_hash,
    reason: row.reason,
    txHash: row.tx_hash,
    createdAt: row.created_at
  };
}

function mapEnrichmentJob(row: EnrichmentJobRow): EnrichmentJobRecord {
  return {
    streamId: row.stream_id,
    nodeId: row.node_id,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

export class DatabaseClient {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    const resolvedPath = resolve(databasePath);
    const directory = dirname(resolvedPath);

    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(schemaSql);
    this.runMigrations();
  }

  close() {
    this.db.close();
  }

  getStream(streamId: string): StreamRecord | null {
    const row = this.db.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as StreamRow | undefined;
    return row ? mapStream(row) : null;
  }

  insertStream(stream: StreamRecord) {
    this.db
      .prepare(
        `INSERT INTO streams (
          id,
          metadata,
          status,
          created_at,
          ended_at,
          created_tx_hash,
          last_snapshot_index,
          last_snapshot_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        stream.id,
        stream.metadata,
        stream.status,
        stream.createdAt,
        stream.endedAt,
        stream.createdTxHash,
        stream.lastSnapshotIndex,
        stream.lastSnapshotHash
      );
  }

  updateStreamSnapshot(streamId: string, snapshotIndex: number, snapshotHash: string) {
    this.db
      .prepare("UPDATE streams SET last_snapshot_index = ?, last_snapshot_hash = ? WHERE id = ?")
      .run(snapshotIndex, snapshotHash, streamId);
  }

  endStream(streamId: string, endedAt: string) {
    this.db.prepare("UPDATE streams SET status = 'ended', ended_at = ? WHERE id = ?").run(endedAt, streamId);
  }

  getNodes(streamId: string): NodeRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM nodes WHERE stream_id = ? ORDER BY node_id ASC")
      .all(streamId) as NodeRow[];

    return rows.map(mapNode);
  }

  getNode(streamId: string, nodeId: number): NodeRecord | null {
    const row = this.db
      .prepare("SELECT * FROM nodes WHERE stream_id = ? AND node_id = ?")
      .get(streamId, nodeId) as NodeRow | undefined;

    return row ? mapNode(row) : null;
  }

  insertNode(node: NodeRecord) {
    this.db
      .prepare(
        `INSERT INTO nodes (
          stream_id,
          node_id,
          text,
          timestamp,
          parent_id,
          branch_type,
          suggested_score,
          suggested_parent_id,
          suggested_branch_type,
          classification,
          ai_status,
          placement_source,
          heuristic_parent_id,
          heuristic_branch_type,
          heuristic_score,
          ai_rationale,
          ai_model
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        node.streamId,
        node.nodeId,
        node.text,
        node.timestamp,
        node.parentId,
        node.branchType,
        node.suggestedScore,
        node.suggestedParentId,
        node.suggestedBranchType,
        node.classification,
        node.aiStatus,
        node.placementSource,
        node.heuristicParentId,
        node.heuristicBranchType,
        node.heuristicScore,
        node.aiRationale,
        node.aiModel
      );
  }

  updateNodePlacement(streamId: string, nodeId: number, parentId: number, branchType: BranchType, placementSource: PlacementSource) {
    this.db
      .prepare(
        "UPDATE nodes SET parent_id = ?, branch_type = ?, placement_source = ? WHERE stream_id = ? AND node_id = ?"
      )
      .run(parentId, branchType, placementSource, streamId, nodeId);
  }

  updateNodeAiResult(node: NodeRecord) {
    this.db
      .prepare(
        `UPDATE nodes SET
          parent_id = ?,
          branch_type = ?,
          suggested_score = ?,
          suggested_parent_id = ?,
          suggested_branch_type = ?,
          classification = ?,
          ai_status = ?,
          placement_source = ?,
          ai_rationale = ?,
          ai_model = ?
        WHERE stream_id = ? AND node_id = ?`
      )
      .run(
        node.parentId,
        node.branchType,
        node.suggestedScore,
        node.suggestedParentId,
        node.suggestedBranchType,
        node.classification,
        node.aiStatus,
        node.placementSource,
        node.aiRationale,
        node.aiModel,
        node.streamId,
        node.nodeId
      );
  }

  updateNodeAiMetadata(
    streamId: string,
    nodeId: number,
    values: Pick<NodeRecord, "suggestedScore" | "suggestedParentId" | "suggestedBranchType" | "classification" | "aiStatus" | "aiRationale" | "aiModel">
  ) {
    this.db
      .prepare(
        `UPDATE nodes SET
          suggested_score = ?,
          suggested_parent_id = ?,
          suggested_branch_type = ?,
          classification = ?,
          ai_status = ?,
          ai_rationale = ?,
          ai_model = ?
        WHERE stream_id = ? AND node_id = ?`
      )
      .run(
        values.suggestedScore,
        values.suggestedParentId,
        values.suggestedBranchType,
        values.classification,
        values.aiStatus,
        values.aiRationale,
        values.aiModel,
        streamId,
        nodeId
      );
  }

  markNodeAiFailed(streamId: string, nodeId: number, aiRationale: string | null) {
    this.db
      .prepare("UPDATE nodes SET ai_status = 'failed', ai_rationale = COALESCE(?, ai_rationale) WHERE stream_id = ? AND node_id = ?")
      .run(aiRationale, streamId, nodeId);
  }

  acceptHeuristicNode(streamId: string, nodeId: number, classification: NodeRecord["classification"], placementSource: PlacementSource) {
    this.db
      .prepare(
        `UPDATE nodes SET
          classification = COALESCE(classification, ?),
          ai_status = 'accepted_heuristic',
          placement_source = ?
        WHERE stream_id = ? AND node_id = ?`
      )
      .run(classification, placementSource, streamId, nodeId);
  }

  getAiSummary(streamId: string) {
    const rows = this.db
      .prepare(
        "SELECT ai_status, COUNT(*) as count FROM nodes WHERE stream_id = ? GROUP BY ai_status"
      )
      .all(streamId) as AiSummaryRow[];

    const pendingCount = rows
      .filter((row) => row.ai_status === "pending")
      .reduce((total, row) => total + row.count, 0);
    const failedCount = rows
      .filter((row) => row.ai_status === "failed")
      .reduce((total, row) => total + row.count, 0);

    return {
      pendingCount,
      failedCount,
      commitBlocked: pendingCount > 0 || failedCount > 0
    };
  }

  getBlockingCommitReason(streamId: string): Extract<CommitSkippedReason, "ai_pending" | "ai_failed"> | null {
    const summary = this.getAiSummary(streamId);
    if (summary.pendingCount > 0) {
      return "ai_pending";
    }

    if (summary.failedCount > 0) {
      return "ai_failed";
    }

    return null;
  }

  getSnapshots(streamId: string): SnapshotRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM snapshots WHERE stream_id = ? ORDER BY snapshot_index DESC")
      .all(streamId) as SnapshotRow[];

    return rows.map(mapSnapshot);
  }

  insertSnapshot(snapshot: SnapshotRecord) {
    this.db
      .prepare(
        `INSERT INTO snapshots (
          stream_id,
          snapshot_index,
          snapshot_hash,
          reason,
          tx_hash,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        snapshot.streamId,
        snapshot.snapshotIndex,
        snapshot.snapshotHash,
        snapshot.reason,
        snapshot.txHash,
        snapshot.createdAt
      );
  }

  enqueueEnrichmentJob(job: EnrichmentJobRecord) {
    this.db
      .prepare(
        `INSERT INTO node_enrichment_jobs (
          stream_id,
          node_id,
          status,
          attempt_count,
          next_attempt_at,
          last_error,
          started_at,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(stream_id, node_id) DO UPDATE SET
          status = excluded.status,
          next_attempt_at = excluded.next_attempt_at,
          last_error = excluded.last_error,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at`
      )
      .run(
        job.streamId,
        job.nodeId,
        job.status,
        job.attemptCount,
        job.nextAttemptAt,
        job.lastError,
        job.startedAt,
        job.completedAt
      );
  }

  getEnrichmentJob(streamId: string, nodeId: number): EnrichmentJobRecord | null {
    const row = this.db
      .prepare("SELECT * FROM node_enrichment_jobs WHERE stream_id = ? AND node_id = ?")
      .get(streamId, nodeId) as EnrichmentJobRow | undefined;

    return row ? mapEnrichmentJob(row) : null;
  }

  getDueEnrichmentJobs(limit: number): EnrichmentJobRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM node_enrichment_jobs
         WHERE status IN ('queued', 'retrying') AND next_attempt_at <= ?
         ORDER BY next_attempt_at ASC, node_id ASC
         LIMIT ?`
      )
      .all(new Date().toISOString(), limit) as EnrichmentJobRow[];

    return rows.map(mapEnrichmentJob);
  }

  markEnrichmentJobRunning(streamId: string, nodeId: number, attemptCount: number, startedAt: string) {
    this.db
      .prepare(
        `UPDATE node_enrichment_jobs SET
          status = 'running',
          attempt_count = ?,
          started_at = ?,
          last_error = NULL
        WHERE stream_id = ? AND node_id = ?`
      )
      .run(attemptCount, startedAt, streamId, nodeId);
  }

  scheduleEnrichmentJobRetry(streamId: string, nodeId: number, nextAttemptAt: string, lastError: string) {
    this.db
      .prepare(
        `UPDATE node_enrichment_jobs SET
          status = 'retrying',
          next_attempt_at = ?,
          last_error = ?,
          started_at = NULL
        WHERE stream_id = ? AND node_id = ?`
      )
      .run(nextAttemptAt, lastError, streamId, nodeId);
  }

  failEnrichmentJob(streamId: string, nodeId: number, completedAt: string, lastError: string) {
    this.db
      .prepare(
        `UPDATE node_enrichment_jobs SET
          status = 'failed',
          last_error = ?,
          completed_at = ?,
          started_at = NULL
        WHERE stream_id = ? AND node_id = ?`
      )
      .run(lastError, completedAt, streamId, nodeId);
  }

  completeEnrichmentJob(streamId: string, nodeId: number, completedAt: string) {
    this.db
      .prepare(
        `UPDATE node_enrichment_jobs SET
          status = 'completed',
          completed_at = ?,
          started_at = NULL,
          last_error = NULL
        WHERE stream_id = ? AND node_id = ?`
      )
      .run(completedAt, streamId, nodeId);
  }

  private runMigrations() {
    this.ensureColumn("nodes", "classification", "TEXT");
    this.ensureColumn("nodes", "ai_status", "TEXT NOT NULL DEFAULT 'pending'");
    this.ensureColumn("nodes", "placement_source", "TEXT NOT NULL DEFAULT 'heuristic'");
    this.ensureColumn("nodes", "heuristic_parent_id", "INTEGER");
    this.ensureColumn("nodes", "heuristic_branch_type", "TEXT NOT NULL DEFAULT 'main'");
    this.ensureColumn("nodes", "heuristic_score", "REAL NOT NULL DEFAULT 0");
    this.ensureColumn("nodes", "ai_rationale", "TEXT");
    this.ensureColumn("nodes", "ai_model", "TEXT");
  }

  private ensureColumn(tableName: string, columnName: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.db.exec(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`);
  }
}
