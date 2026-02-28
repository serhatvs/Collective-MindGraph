import { describe, expect, it } from "vitest";

import {
  collectDescendantIds,
  computeSnapshotHash,
  deterministicScore,
  getAvailableSideSlot,
  getDefaultClassification,
  isValidParentCandidate,
  jaccardSimilarity,
  resolveBranchTypeForOverride,
  suggestPlacement,
  tokenizeText,
  type NodeRecord
} from "../src";

function makeNode(overrides: Partial<NodeRecord>): NodeRecord {
  return {
    nodeId: 1,
    streamId: "1",
    text: "root",
    timestamp: "2026-01-01T00:00:00.000Z",
    parentId: null,
    branchType: "main",
    suggestedScore: null,
    suggestedParentId: null,
    suggestedBranchType: "main",
    classification: null,
    aiStatus: "completed",
    placementSource: "heuristic",
    heuristicParentId: null,
    heuristicBranchType: "main",
    heuristicScore: 1,
    aiRationale: null,
    aiModel: null,
    ...overrides
  };
}

describe("graph utilities", () => {
  it("tokenizes text deterministically", () => {
    expect(tokenizeText("Hello, HELLO... debate!")).toEqual(["hello", "debate"]);
  });

  it("computes jaccard similarity from unique tokens", () => {
    expect(jaccardSimilarity("cats dogs", "cats birds")).toBeCloseTo(1 / 3);
  });

  it("uses a deterministic score", () => {
    const first = deterministicScore("1", 2, "tax policy debate", "tax debate");
    const second = deterministicScore("1", 2, "tax policy debate", "tax debate");

    expect(first).toBe(second);
  });

  it("prefers better scoring parents and side slots in order", () => {
    const nodes: NodeRecord[] = [
      makeNode({ nodeId: 1, text: "tax cuts for growth" }),
      makeNode({ nodeId: 2, parentId: 1, branchType: "main", text: "tax cuts help jobs" }),
      makeNode({ nodeId: 3, parentId: 1, branchType: "side1", text: "climate regulation costs" })
    ];

    const suggestion = suggestPlacement(nodes, "1", "tax cuts help wages");

    expect(suggestion).not.toBeNull();
    expect(suggestion?.parentId).toBe(2);
    expect(suggestion?.branchType).toBe("main");
  });

  it("chooses side slots sequentially", () => {
    const nodes: NodeRecord[] = [
      makeNode({ nodeId: 1 }),
      makeNode({ nodeId: 2, parentId: 1, branchType: "side1" })
    ];

    expect(getAvailableSideSlot(nodes, 1)).toBe("side2");
  });

  it("rejects parent moves into descendants", () => {
    const nodes: NodeRecord[] = [
      makeNode({ nodeId: 1 }),
      makeNode({ nodeId: 2, parentId: 1, branchType: "main" }),
      makeNode({ nodeId: 3, parentId: 2, branchType: "main" })
    ];

    expect(collectDescendantIds(nodes, 2)).toEqual(new Set([3]));
    expect(isValidParentCandidate(nodes, 2, 3)).toBe(false);
    expect(isValidParentCandidate(nodes, 3, 1)).toBe(true);
  });

  it("resolves override branches according to availability", () => {
    const nodes: NodeRecord[] = [
      makeNode({ nodeId: 1 }),
      makeNode({ nodeId: 2, parentId: 1, branchType: "main" }),
      makeNode({ nodeId: 3, parentId: 1, branchType: "side1" }),
      makeNode({ nodeId: 4, parentId: 2, branchType: "main" })
    ];
    const nestedNode = nodes[3];

    expect(nestedNode).toBeDefined();

    const branch = resolveBranchTypeForOverride(nodes, nestedNode!, 1, "side");
    expect(branch).toBe("side2");
    expect(resolveBranchTypeForOverride(nodes, nestedNode!, 1, "main")).toBeNull();
  });

  it("creates stable snapshot hashes", () => {
    const nodes: NodeRecord[] = [
      makeNode({ nodeId: 2, parentId: 1, branchType: "main", text: "two" }),
      makeNode({ nodeId: 1, text: "one" })
    ];

    expect(computeSnapshotHash(nodes)).toBe(computeSnapshotHash([...nodes].reverse()));
  });

  it("derives useful default classifications", () => {
    expect(getDefaultClassification("Why does this happen?")).toBe("question");
    expect(getDefaultClassification("However this is wrong")).toBe("counter");
    expect(getDefaultClassification("Because the evidence supports it")).toBe("support");
    expect(getDefaultClassification("This is a baseline claim")).toBe("claim");
  });
});
