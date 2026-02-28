import type { AiContextPayload } from "@cmg/shared";
import { describe, expect, it, vi } from "vitest";

import { createAiService } from "./aiService.js";

function createContext(): AiContextPayload {
  return {
    streamId: "1",
    targetNode: {
      nodeId: 3,
      text: "Tax cuts help wages and jobs",
      timestamp: "2026-01-01T00:01:00.000Z"
    },
    currentGraph: [
      {
        nodeId: 1,
        parentId: null,
        branchType: "main",
        text: "Tax reform debate",
        classification: "claim"
      },
      {
        nodeId: 2,
        parentId: 1,
        branchType: "main",
        text: "Tax cuts help jobs",
        classification: "support"
      }
    ],
    validParentCandidates: [
      {
        nodeId: 1,
        allowsMain: false,
        nextAvailableSideSlot: "side1"
      },
      {
        nodeId: 2,
        allowsMain: true,
        nextAvailableSideSlot: "side1"
      }
    ]
  };
}

function createLargeContext(): AiContextPayload {
  return {
    streamId: "99",
    targetNode: {
      nodeId: 12,
      text: "Remote work improves hiring reach and cuts office overhead.",
      timestamp: "2026-01-01T00:12:00.000Z"
    },
    currentGraph: [
      {
        nodeId: 1,
        parentId: null,
        branchType: "main",
        text: "Should remote work stay the default?",
        classification: "question"
      },
      {
        nodeId: 2,
        parentId: 1,
        branchType: "main",
        text: "Remote work expands talent access",
        classification: "support"
      },
      {
        nodeId: 3,
        parentId: 2,
        branchType: "main",
        text: "Companies can hire across regions",
        classification: "support"
      },
      {
        nodeId: 4,
        parentId: 1,
        branchType: "side1",
        text: "Office culture gets weaker remotely",
        classification: "counter"
      },
      {
        nodeId: 5,
        parentId: 4,
        branchType: "main",
        text: "Junior mentoring suffers",
        classification: "support"
      },
      {
        nodeId: 6,
        parentId: 1,
        branchType: "side2",
        text: "Hybrid is a better middle ground",
        classification: "claim"
      },
      {
        nodeId: 7,
        parentId: 6,
        branchType: "main",
        text: "Hybrid keeps some in-person collaboration",
        classification: "support"
      },
      {
        nodeId: 8,
        parentId: 3,
        branchType: "main",
        text: "Distributed hiring lowers salary pressure in hubs",
        classification: "support"
      },
      {
        nodeId: 9,
        parentId: 8,
        branchType: "main",
        text: "Office leases also become less necessary",
        classification: "support"
      },
      {
        nodeId: 10,
        parentId: 5,
        branchType: "side1",
        text: "Async documentation can offset some mentoring loss",
        classification: "counter"
      },
      {
        nodeId: 11,
        parentId: 7,
        branchType: "side1",
        text: "Hybrid still creates unequal team experiences",
        classification: "counter"
      }
    ],
    validParentCandidates: [
      {
        nodeId: 1,
        allowsMain: false,
        nextAvailableSideSlot: null
      },
      {
        nodeId: 2,
        allowsMain: false,
        nextAvailableSideSlot: "side1"
      },
      {
        nodeId: 3,
        allowsMain: false,
        nextAvailableSideSlot: "side1"
      },
      {
        nodeId: 4,
        allowsMain: false,
        nextAvailableSideSlot: "side2"
      },
      {
        nodeId: 5,
        allowsMain: true,
        nextAvailableSideSlot: "side2"
      },
      {
        nodeId: 6,
        allowsMain: false,
        nextAvailableSideSlot: null
      },
      {
        nodeId: 7,
        allowsMain: false,
        nextAvailableSideSlot: "side2"
      },
      {
        nodeId: 8,
        allowsMain: false,
        nextAvailableSideSlot: "side1"
      },
      {
        nodeId: 9,
        allowsMain: true,
        nextAvailableSideSlot: "side1"
      },
      {
        nodeId: 10,
        allowsMain: true,
        nextAvailableSideSlot: "side2"
      },
      {
        nodeId: 11,
        allowsMain: true,
        nextAvailableSideSlot: "side2"
      }
    ]
  };
}

function createCounterContext(): AiContextPayload {
  return {
    streamId: "12",
    targetNode: {
      nodeId: 4,
      text: "However remote work weakens junior mentoring and feedback loops.",
      timestamp: "2026-01-01T00:04:00.000Z"
    },
    currentGraph: [
      {
        nodeId: 1,
        parentId: null,
        branchType: "main",
        text: "Should remote work stay the default?",
        classification: "question"
      },
      {
        nodeId: 2,
        parentId: 1,
        branchType: "main",
        text: "Remote work improves hiring reach",
        classification: "support"
      },
      {
        nodeId: 3,
        parentId: 2,
        branchType: "main",
        text: "Junior teams receive broader candidate pools",
        classification: "support"
      }
    ],
    validParentCandidates: [
      {
        nodeId: 1,
        allowsMain: false,
        nextAvailableSideSlot: "side1"
      },
      {
        nodeId: 2,
        allowsMain: false,
        nextAvailableSideSlot: "side1"
      },
      {
        nodeId: 3,
        allowsMain: true,
        nextAvailableSideSlot: "side1"
      }
    ]
  };
}

describe("ai service", () => {
  it("handles root nodes with the local heuristic provider", async () => {
    const service = createAiService({
      model: "local-heuristic-v1",
      timeoutMs: 250
    });

    const recommendation = await service.analyzeNode({
      streamId: "1",
      targetNode: {
        nodeId: 1,
        text: "What should the room debate first?",
        timestamp: "2026-01-01T00:00:00.000Z"
      },
      currentGraph: [],
      validParentCandidates: []
    });

    expect(service.model).toBe("local-heuristic-v1");
    expect(recommendation.parentNodeId).toBeNull();
    expect(recommendation.branchKind).toBe("main");
    expect(recommendation.classification).toBe("question");
  });

  it("places similar follow-up nodes on the main branch with the local provider", async () => {
    const service = createAiService({
      provider: "local",
      model: "local-heuristic-v1",
      timeoutMs: 250
    });

    const recommendation = await service.analyzeNode(createContext());

    expect(recommendation.parentNodeId).toBe(2);
    expect(recommendation.branchKind).toBe("main");
    expect(recommendation.classification).toBe("support");
    expect(recommendation.confidence).toBeGreaterThanOrEqual(0.62);
  });

  it("routes counter-arguments onto a side branch with the local provider", async () => {
    const service = createAiService({
      provider: "local",
      model: "local-heuristic-v2",
      timeoutMs: 250
    });

    const recommendation = await service.analyzeNode(createCounterContext());

    expect([2, 3]).toContain(recommendation.parentNodeId);
    expect(recommendation.branchKind).toBe("side");
    expect(recommendation.classification).toBe("counter");
  });

  it("routes Ollama requests to the native chat endpoint and parses structured output", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              parentNodeId: 2,
              branchKind: "main",
              classification: "support",
              confidence: 0.83,
              rationale: "Most similar continuation under node 2."
            })
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    const service = createAiService({
      provider: "ollama",
      model: "llama3.2:3b",
      timeoutMs: 2_000,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      fetchImpl: fetchMock
    });

    const recommendation = await service.analyzeNode(createContext());

    expect(recommendation.parentNodeId).toBe(2);
    expect(recommendation.branchKind).toBe("main");
    expect(recommendation.classification).toBe("support");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(request?.body));

    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(body.model).toBe("llama3.2:3b");
    expect(body.stream).toBe(false);
    expect(body.messages[1].content).toContain("\"streamId\":\"1\"");
  });

  it("preserves Ollama HTTP status codes for retry handling", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "Ollama is warming up." }), {
        status: 503,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const service = createAiService({
      provider: "ollama",
      model: "llama3.2:3b",
      timeoutMs: 2_000,
      ollamaBaseUrl: "http://127.0.0.1:11434/api",
      fetchImpl: fetchMock
    });

    await expect(service.analyzeNode(createContext())).rejects.toMatchObject({
      message: "Ollama is warming up.",
      status: 503
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/chat",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("sends Ollama a reduced shortlist instead of the full graph", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              parentNodeId: 9,
              branchKind: "main",
              classification: "support",
              confidence: 0.88,
              rationale: "Best continuation under node 9."
            })
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    const service = createAiService({
      provider: "ollama",
      model: "llama3.2:3b",
      timeoutMs: 2_000,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      fetchImpl: fetchMock
    });

    await service.analyzeNode(createLargeContext());

    const [, request] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(request?.body));
    const payload = JSON.parse(String(body.messages[1].content));

    expect(payload.validParentCandidates).toHaveLength(6);
    expect(payload.currentGraph.length).toBeLessThanOrEqual(14);
    expect(payload.candidateSummaries).toHaveLength(6);
    expect(payload.heuristicTopChoice.parentNodeId).toBeDefined();
    expect(payload.validParentCandidates.some((candidate: { nodeId: number }) => candidate.nodeId === 9)).toBe(true);
  });
});
