import { z } from "zod";

export const MAX_NODES_PER_STREAM = 50;
export const CANDIDATE_WINDOW = 10;
export const SIMILARITY_THRESHOLD = 0.35;
export const DEFAULT_STREAM_METADATA = "collective-mindgraph-mvp";

export const branchTypeSchema = z.enum(["main", "side1", "side2"]);
export const branchKindSchema = z.enum(["main", "side"]);
export const snapshotReasonSchema = z.enum(["auto", "manual", "final"]);
export const streamStatusSchema = z.enum(["active", "ended"]);
export const aiStatusSchema = z.enum(["pending", "completed", "failed", "accepted_heuristic"]);
export const classificationSchema = z.enum(["claim", "support", "counter", "question"]);
export const placementSourceSchema = z.enum(["heuristic", "ai", "manual", "heuristic_accepted"]);
export const enrichmentJobStatusSchema = z.enum(["queued", "running", "retrying", "failed", "completed", "cancelled"]);
export const commitSkippedReasonSchema = z.enum(["no_nodes", "no_changes", "ai_pending", "ai_failed"]);

export type BranchType = z.infer<typeof branchTypeSchema>;
export type BranchKind = z.infer<typeof branchKindSchema>;
export type SnapshotReason = z.infer<typeof snapshotReasonSchema>;
export type StreamStatus = z.infer<typeof streamStatusSchema>;
export type AiStatus = z.infer<typeof aiStatusSchema>;
export type Classification = z.infer<typeof classificationSchema>;
export type PlacementSource = z.infer<typeof placementSourceSchema>;
export type EnrichmentJobStatus = z.infer<typeof enrichmentJobStatusSchema>;
export type CommitSkippedReason = z.infer<typeof commitSkippedReasonSchema>;

export interface StreamRecord {
  id: string;
  metadata: string | null;
  status: StreamStatus;
  createdAt: string;
  endedAt: string | null;
  createdTxHash: string;
  lastSnapshotIndex: number;
  lastSnapshotHash: string | null;
}

export interface NodeRecord {
  nodeId: number;
  streamId: string;
  text: string;
  timestamp: string;
  parentId: number | null;
  branchType: BranchType;
  suggestedScore: number | null;
  suggestedParentId: number | null;
  suggestedBranchType: BranchType;
  classification: Classification | null;
  aiStatus: AiStatus;
  placementSource: PlacementSource;
  heuristicParentId: number | null;
  heuristicBranchType: BranchType;
  heuristicScore: number;
  aiRationale: string | null;
  aiModel: string | null;
}

export interface SnapshotRecord {
  streamId: string;
  snapshotIndex: number;
  snapshotHash: string;
  reason: SnapshotReason;
  txHash: string;
  createdAt: string;
}

export interface StreamDetail {
  stream: StreamRecord;
  nodes: NodeRecord[];
  snapshots: SnapshotRecord[];
  limits: {
    maxNodes: number;
    nodeCount: number;
    canAddNode: boolean;
  };
  ai: {
    pendingCount: number;
    failedCount: number;
    commitBlocked: boolean;
  };
}

export interface PlacementSuggestion {
  parentId: number | null;
  branchType: BranchType;
  score: number;
}

export interface ValidParentCandidate {
  nodeId: number;
  allowsMain: boolean;
  nextAvailableSideSlot: "side1" | "side2" | null;
}

export interface AiPlacementRecommendation {
  parentNodeId: number | null;
  branchKind: BranchKind;
  classification: Classification;
  confidence: number;
  rationale: string;
}

export interface EnrichmentJobRecord {
  streamId: string;
  nodeId: number;
  status: EnrichmentJobStatus;
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AiContextPayload {
  streamId: string;
  targetNode: Pick<NodeRecord, "nodeId" | "text" | "timestamp">;
  currentGraph: Array<Pick<NodeRecord, "nodeId" | "parentId" | "branchType" | "text" | "classification">>;
  validParentCandidates: ValidParentCandidate[];
}

export const createStreamRequestSchema = z.object({
  metadata: z.string().trim().max(256).optional()
});

export const createNodeRequestSchema = z.object({
  text: z.string().trim().min(1).max(4_000)
});

export const updateNodeRequestSchema = z.object({
  parentId: z.number().int().positive(),
  branchKind: branchKindSchema
});

export const commitRequestSchema = z.object({
  reason: snapshotReasonSchema
});

export type CreateStreamRequest = z.infer<typeof createStreamRequestSchema>;
export type CreateNodeRequest = z.infer<typeof createNodeRequestSchema>;
export type UpdateNodeRequest = z.infer<typeof updateNodeRequestSchema>;
export type CommitRequest = z.infer<typeof commitRequestSchema>;
