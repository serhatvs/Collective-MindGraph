import {
  MAX_NODES_PER_STREAM,
  collectDescendantIds,
  resolveBranchTypeForOverride,
  suggestPlacement,
  type BranchKind,
  type NodeRecord,
  type PlacementSource
} from "@cmg/shared";

import type { DatabaseClient } from "../db/client.js";
import { AppError, assert } from "../lib/errors.js";
import type { EnrichmentService } from "./enrichmentService.js";

function assertStreamActive(status: string) {
  if (status === "ended") {
    throw new AppError(409, "STREAM_ENDED", "The stream has already ended.");
  }
}

export class GraphService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly enrichmentService: EnrichmentService
  ) {}

  addNode(streamId: string, text: string): NodeRecord {
    const stream = this.db.getStream(streamId);
    assert(stream, new AppError(404, "STREAM_NOT_FOUND", "Stream not found."));
    assertStreamActive(stream.status);

    const nodes = this.db.getNodes(streamId);
    if (nodes.length >= MAX_NODES_PER_STREAM) {
      throw new AppError(409, "NODE_LIMIT_REACHED", "The stream has reached the 50 node limit.");
    }

    const timestamp = new Date().toISOString();

    if (nodes.length === 0) {
      const rootNode: NodeRecord = {
        nodeId: 1,
        streamId,
        text,
        timestamp,
        parentId: null,
        branchType: "main",
        suggestedScore: null,
        suggestedParentId: null,
        suggestedBranchType: "main",
        classification: null,
        aiStatus: "pending",
        placementSource: "heuristic",
        heuristicParentId: null,
        heuristicBranchType: "main",
        heuristicScore: 1,
        aiRationale: null,
        aiModel: null
      };

      this.db.insertNode(rootNode);
      this.enrichmentService.enqueueNode(streamId, rootNode.nodeId);
      return rootNode;
    }

    const suggestion = suggestPlacement(nodes, streamId, text);
    if (!suggestion || suggestion.parentId === null) {
      throw new AppError(409, "TREE_CAPACITY_EXHAUSTED", "No valid placement remains in the tree.");
    }

    const lastNode = nodes.at(-1);
    assert(lastNode, new AppError(500, "NODE_SEQUENCE_INVALID", "Failed to determine the next node id."));
    const nextNodeId = lastNode.nodeId + 1;
    const node: NodeRecord = {
      nodeId: nextNodeId,
      streamId,
      text,
      timestamp,
      parentId: suggestion.parentId,
      branchType: suggestion.branchType,
      suggestedScore: null,
      suggestedParentId: suggestion.parentId,
      suggestedBranchType: suggestion.branchType,
      classification: null,
      aiStatus: "pending",
      placementSource: "heuristic",
      heuristicParentId: suggestion.parentId,
      heuristicBranchType: suggestion.branchType,
      heuristicScore: suggestion.score,
      aiRationale: null,
      aiModel: null
    };

    this.db.insertNode(node);
    this.enrichmentService.enqueueNode(streamId, node.nodeId);
    return node;
  }

  overrideNode(streamId: string, nodeId: number, parentId: number, branchKind: BranchKind): NodeRecord {
    const stream = this.db.getStream(streamId);
    assert(stream, new AppError(404, "STREAM_NOT_FOUND", "Stream not found."));
    assertStreamActive(stream.status);

    const nodes = this.db.getNodes(streamId);
    const node = nodes.find((entry) => entry.nodeId === nodeId);
    assert(node, new AppError(404, "NODE_NOT_FOUND", "Node not found."));
    assert(node.nodeId !== 1, new AppError(409, "ROOT_NODE_IMMUTABLE", "The root node cannot be overridden."));

    const targetParent = nodes.find((entry) => entry.nodeId === parentId);
    assert(targetParent, new AppError(404, "PARENT_NOT_FOUND", "Parent node not found."));

    if (parentId === nodeId || collectDescendantIds(nodes, nodeId).has(parentId)) {
      throw new AppError(409, "INVALID_PARENT", "A node cannot move under itself or one of its descendants.");
    }

    const branchType = resolveBranchTypeForOverride(nodes, node, parentId, branchKind);
    if (!branchType) {
      if (branchKind === "main") {
        throw new AppError(409, "MAIN_BRANCH_OCCUPIED", "The selected parent already has a main child.");
      }

      throw new AppError(409, "SIDE_BRANCH_LIMIT_REACHED", "The selected parent already has two side branches.");
    }

    const placementSource: PlacementSource = "manual";
    this.db.updateNodePlacement(streamId, nodeId, parentId, branchType, placementSource);

    return {
      ...node,
      parentId,
      branchType,
      placementSource
    };
  }
}
