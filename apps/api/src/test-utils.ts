import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AiContextPayload, AiPlacementRecommendation } from "@cmg/shared";

import type { AiService } from "./services/aiService.js";
import type { ChainService } from "./services/chainService.js";

export function createTempDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "cmg-api-"));
  const path = join(directory, "test.sqlite");

  return {
    directory,
    path,
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

export function createFakeChainService(): ChainService {
  let nextStreamId = 1;
  let nextTxId = 1;

  return {
    async createStream() {
      const streamId = `${nextStreamId}`;
      nextStreamId += 1;

      return {
        streamId,
        txHash: `0xcreate${String(nextTxId++).padStart(4, "0")}`
      };
    },
    async commitSnapshot() {
      return {
        txHash: `0xcommit${String(nextTxId++).padStart(4, "0")}`
      };
    }
  };
}

function defaultRecommendation(context: AiContextPayload): AiPlacementRecommendation {
  if (context.targetNode.nodeId === 1) {
    return {
      parentNodeId: null,
      branchKind: "main",
      classification: "claim",
      confidence: 0.91,
      rationale: "Root node starts the main line of discussion."
    };
  }

  const candidate = context.validParentCandidates[0];
  if (!candidate) {
    throw new Error("No valid AI parent candidate.");
  }

  return {
    parentNodeId: candidate.nodeId,
    branchKind: candidate.allowsMain ? "main" : "side",
    classification: "support",
    confidence: 0.77,
    rationale: `Node connects most directly to #${candidate.nodeId}.`
  };
}

export function createFakeAiService(
  handler?: (context: AiContextPayload) => AiPlacementRecommendation | Promise<AiPlacementRecommendation>
): AiService {
  return {
    model: "fake-ai",
    async analyzeNode(context) {
      if (handler) {
        return await handler(context);
      }

      return defaultRecommendation(context);
    }
  };
}
