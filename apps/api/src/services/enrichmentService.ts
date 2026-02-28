import {
  getDefaultClassification,
  getMainChild,
  getValidParentCandidates,
  resolveBranchTypeForOverride,
  type AiContextPayload,
  type AiPlacementRecommendation,
  type BranchType,
  type EnrichmentJobRecord,
  type NodeRecord,
  type PlacementSource
} from "@cmg/shared";

import type { DatabaseClient } from "../db/client.js";
import { AppError, assert } from "../lib/errors.js";
import type { AiService } from "./aiService.js";
import type { StreamLock } from "./streamLock.js";

const RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

export class RetryableEnrichmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableEnrichmentError";
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "Unknown enrichment error";
}

function isRetryableFailure(error: unknown): boolean {
  if (error instanceof RetryableEnrichmentError) {
    return true;
  }

  const status = typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status
    : undefined;
  if (status !== undefined) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }

  const name = typeof (error as { name?: unknown })?.name === "string"
    ? (error as { name: string }).name
    : undefined;

  return name === "APIConnectionError" || name === "APIConnectionTimeoutError";
}

export class EnrichmentService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly aiService: AiService,
    private readonly streamLock: StreamLock
  ) {}

  enqueueNode(streamId: string, nodeId: number) {
    const now = new Date().toISOString();
    this.db.enqueueEnrichmentJob({
      streamId,
      nodeId,
      status: "queued",
      attemptCount: 0,
      nextAttemptAt: now,
      lastError: null,
      startedAt: null,
      completedAt: null
    });
  }

  getDueJobs(limit: number): EnrichmentJobRecord[] {
    return this.db.getDueEnrichmentJobs(limit);
  }

  async processJob(job: EnrichmentJobRecord): Promise<void> {
    const attemptCount = job.attemptCount + 1;
    this.db.markEnrichmentJobRunning(job.streamId, job.nodeId, attemptCount, new Date().toISOString());

    try {
      const node = this.db.getNode(job.streamId, job.nodeId);
      assert(node, new AppError(404, "NODE_NOT_FOUND", "Node not found."));

      const nodes = this.db.getNodes(job.streamId);
      const context = this.buildContext(job.streamId, node, nodes);
      const recommendation = await this.aiService.analyzeNode(context);

      await this.streamLock.runExclusive(job.streamId, async () => {
        this.applyRecommendation(job.streamId, job.nodeId, recommendation);
      });

      this.db.completeEnrichmentJob(job.streamId, job.nodeId, new Date().toISOString());
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      if (isRetryableFailure(error) && attemptCount <= RETRY_DELAYS_MS.length) {
        const retryDelayMs = RETRY_DELAYS_MS.at(attemptCount - 1);
        assert(
          retryDelayMs !== undefined,
          new AppError(500, "ENRICHMENT_RETRY_CONFIG_INVALID", "Missing retry delay configuration.")
        );
        const nextAttemptAt = new Date(Date.now() + retryDelayMs).toISOString();
        this.db.scheduleEnrichmentJobRetry(job.streamId, job.nodeId, nextAttemptAt, errorMessage);
        return;
      }

      this.db.markNodeAiFailed(job.streamId, job.nodeId, errorMessage);
      this.db.failEnrichmentJob(job.streamId, job.nodeId, new Date().toISOString(), errorMessage);
    }
  }

  acceptHeuristic(streamId: string, nodeId: number): NodeRecord {
    const stream = this.db.getStream(streamId);
    assert(stream, new AppError(404, "STREAM_NOT_FOUND", "Stream not found."));
    if (stream.status === "ended") {
      throw new AppError(409, "STREAM_ENDED", "The stream has already ended.");
    }

    const node = this.db.getNode(streamId, nodeId);
    assert(node, new AppError(404, "NODE_NOT_FOUND", "Node not found."));

    if (node.aiStatus !== "failed") {
      throw new AppError(409, "NODE_NOT_FAILED", "Only failed AI nodes can accept the heuristic placement.");
    }

    const classification = node.classification ?? getDefaultClassification(node.text);
    const placementSource: PlacementSource = node.placementSource === "manual" ? "manual" : "heuristic_accepted";

    this.db.acceptHeuristicNode(streamId, nodeId, classification, placementSource);

    const updatedNode = this.db.getNode(streamId, nodeId);
    assert(updatedNode, new AppError(404, "NODE_NOT_FOUND", "Node not found."));
    return updatedNode;
  }

  private buildContext(streamId: string, node: NodeRecord, nodes: NodeRecord[]): AiContextPayload {
    return {
      streamId,
      targetNode: {
        nodeId: node.nodeId,
        text: node.text,
        timestamp: node.timestamp
      },
      currentGraph: nodes.map((entry) => ({
        nodeId: entry.nodeId,
        parentId: entry.parentId,
        branchType: entry.branchType,
        text: entry.text,
        classification: entry.classification
      })),
      validParentCandidates: getValidParentCandidates(nodes, node)
    };
  }

  private applyRecommendation(streamId: string, nodeId: number, recommendation: AiPlacementRecommendation) {
    const nodes = this.db.getNodes(streamId);
    const node = nodes.find((entry) => entry.nodeId === nodeId);
    assert(node, new AppError(404, "NODE_NOT_FOUND", "Node not found."));

    const suggestedBranchType = this.resolveSuggestedBranchType(nodes, node, recommendation);
    const baseMetadata = {
      suggestedScore: recommendation.confidence,
      suggestedParentId: recommendation.parentNodeId,
      suggestedBranchType,
      classification: recommendation.classification,
      aiStatus: "completed" as const,
      aiRationale: recommendation.rationale,
      aiModel: this.aiService.model
    };

    if (node.placementSource === "manual") {
      this.db.updateNodeAiMetadata(streamId, nodeId, baseMetadata);
      return;
    }

    const placementSource: PlacementSource = "ai";
    const updatedNode: NodeRecord = {
      ...node,
      parentId: recommendation.parentNodeId,
      branchType: suggestedBranchType,
      suggestedScore: recommendation.confidence,
      suggestedParentId: recommendation.parentNodeId,
      suggestedBranchType,
      classification: recommendation.classification,
      aiStatus: "completed",
      placementSource,
      aiRationale: recommendation.rationale,
      aiModel: this.aiService.model
    };

    this.db.updateNodeAiResult(updatedNode);
  }

  private resolveSuggestedBranchType(nodes: NodeRecord[], node: NodeRecord, recommendation: AiPlacementRecommendation): BranchType {
    if (node.nodeId === 1) {
      if (recommendation.parentNodeId !== null || recommendation.branchKind !== "main") {
        throw new RetryableEnrichmentError("Root recommendation must remain on the main branch with no parent.");
      }

      return "main";
    }

    if (recommendation.parentNodeId === null) {
      throw new RetryableEnrichmentError("Non-root recommendations must choose a parent.");
    }

    const validCandidates = getValidParentCandidates(nodes, node).map((candidate) => candidate.nodeId);
    if (!validCandidates.includes(recommendation.parentNodeId)) {
      throw new RetryableEnrichmentError("AI chose an invalid parent candidate.");
    }

    if (recommendation.branchKind === "main") {
      const mainChild = getMainChild(nodes, recommendation.parentNodeId, node.nodeId);
      if (mainChild) {
        throw new RetryableEnrichmentError("AI chose an occupied main branch.");
      }

      return "main";
    }

    const branchType = resolveBranchTypeForOverride(nodes, node, recommendation.parentNodeId, "side");
    if (!branchType || branchType === "main") {
      throw new RetryableEnrichmentError("AI chose a side branch that is no longer available.");
    }

    return branchType;
  }
}
