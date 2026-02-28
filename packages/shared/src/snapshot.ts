import { keccak256, stringToBytes } from "viem";

import type { NodeRecord } from "./types";

export interface CanonicalSnapshotNode {
  nodeId: number;
  text: string;
  timestamp: string;
  parentId: number | null;
  branchType: NodeRecord["branchType"];
  suggestedScore: number | null;
  classification: NodeRecord["classification"];
}

export function buildCanonicalSnapshotNodes(nodes: NodeRecord[]): CanonicalSnapshotNode[] {
  return [...nodes]
    .sort((left, right) => left.nodeId - right.nodeId)
    .map((node) => ({
      nodeId: node.nodeId,
      text: node.text,
      timestamp: node.timestamp,
      parentId: node.parentId,
      branchType: node.branchType,
      suggestedScore: node.suggestedScore,
      classification: node.classification
    }));
}

export function buildCanonicalSnapshotJson(nodes: NodeRecord[]): string {
  return JSON.stringify(buildCanonicalSnapshotNodes(nodes));
}

export function computeSnapshotHash(nodes: NodeRecord[]): string {
  return keccak256(stringToBytes(buildCanonicalSnapshotJson(nodes)));
}
