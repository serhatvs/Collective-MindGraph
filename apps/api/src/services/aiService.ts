import type {
  AiContextPayload,
  AiPlacementRecommendation,
  BranchKind,
  Classification
} from "@cmg/shared";
import {
  deterministicScore,
  getDefaultClassification,
  tokenizeText,
  SIMILARITY_THRESHOLD
} from "@cmg/shared";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const aiRecommendationSchema = z.object({
  parentNodeId: z.number().int().positive().nullable(),
  branchKind: z.enum(["main", "side"]),
  classification: z.enum(["claim", "support", "counter", "question"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(240)
});

const SYSTEM_PROMPT = [
  "You place discussion nodes into a constrained debate tree.",
  "Follow these rules exactly:",
  "- Root node must use parentNodeId=null and branchKind=main.",
  "- Non-root nodes must choose a parentNodeId from validParentCandidates only.",
  "- branchKind=main means the node continues the primary line under that parent.",
  "- branchKind=side means the node should be attached as a side branch under that parent.",
  "- Classifications must be one of claim, support, counter, question.",
  "- Return only valid structured output.",
  "- Keep rationale short and concrete."
].join("\n");

const OLLAMA_RESPONSE_SCHEMA = aiRecommendationSchema.toJSONSchema();
const OLLAMA_MAX_PARENT_CANDIDATES = 6;
const OLLAMA_MAX_GRAPH_NODES = 14;
const LOCAL_MAIN_CONTINUATION_THRESHOLD = 0.24;

interface RankedCandidateEntry {
  candidate: AiContextPayload["validParentCandidates"][number];
  node: AiContextPayload["currentGraph"][number];
  score: number;
}

export interface AiService {
  readonly model: string;
  analyzeNode(context: AiContextPayload): Promise<AiPlacementRecommendation>;
}

export type AiProvider = "local" | "openai" | "ollama";

class DisabledAiService implements AiService {
  readonly model = "disabled";

  constructor(private readonly message: string) {}

  async analyzeNode(): Promise<AiPlacementRecommendation> {
    throw new Error(this.message);
  }
}

class LocalAiService implements AiService {
  constructor(readonly model: string) {}

  async analyzeNode(context: AiContextPayload): Promise<AiPlacementRecommendation> {
    const rootClassification = getDefaultClassification(context.targetNode.text);
    if (context.targetNode.nodeId === 1) {
      return {
        parentNodeId: null,
        branchKind: "main",
        classification: rootClassification === "question" ? "question" : "claim",
        confidence: 0.99,
        rationale: "Local heuristic anchored the root node on the main line."
      };
    }

    const targetClassification = getDefaultClassification(context.targetNode.text);
    const rankedCandidates = rankCandidates(context);

    for (const entry of rankedCandidates) {
      const branchKind = chooseBranchKind(entry.candidate, entry.score, targetClassification);
      if (!branchKind) {
        continue;
      }

      return {
        parentNodeId: entry.node.nodeId,
        branchKind,
        classification: resolveClassification(context.targetNode.text, branchKind),
        confidence: toConfidence(entry.score, branchKind),
        rationale: buildRationale(entry.node, entry.score, branchKind, targetClassification)
      };
    }

    throw new Error("Local AI could not find a valid parent placement.");
  }
}

class OpenAiService implements AiService {
  constructor(
    private readonly client: OpenAI,
    readonly model: string,
    private readonly timeoutMs: number
  ) {}

  async analyzeNode(context: AiContextPayload): Promise<AiPlacementRecommendation> {
    const response = await this.client.responses.parse(
      {
        model: this.model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: SYSTEM_PROMPT
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(context)
              }
            ]
          }
        ],
        text: {
          format: zodTextFormat(aiRecommendationSchema, "node_enrichment")
        }
      },
      {
        timeout: this.timeoutMs
      }
    );

    const parsed = response.output_parsed;
    if (!parsed) {
      throw new Error("OpenAI did not return a structured enrichment payload.");
    }

    return parsed;
  }
}

interface OllamaChatResponse {
  error?: string;
  message?: {
    content?: string;
  };
}

class AiProviderRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    name = "AiProviderError"
  ) {
    super(message);
    this.name = name;
  }
}

class OllamaAiService implements AiService {
  private readonly chatUrl: string;

  constructor(
    private readonly fetchImpl: typeof fetch,
    readonly model: string,
    private readonly timeoutMs: number,
    baseUrl: string,
    private readonly apiKey?: string
  ) {
    this.chatUrl = resolveOllamaChatUrl(baseUrl);
  }

  async analyzeNode(context: AiContextPayload): Promise<AiPlacementRecommendation> {
    const promptPayload = buildOllamaPromptPayload(context);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.chatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: OLLAMA_RESPONSE_SCHEMA,
          options: {
            temperature: 0
          },
          messages: [
            {
              role: "system",
              content: [
                SYSTEM_PROMPT,
                "Use heuristicTopChoice only as a tie-breaker or sanity check, not as an absolute requirement.",
                "Return a JSON object that exactly matches the provided schema.",
                "Do not wrap the JSON in markdown or add extra text."
              ].join("\n")
            },
            {
              role: "user",
              content: JSON.stringify(promptPayload)
            }
          ]
        }),
        signal: controller.signal
      });

      const rawBody = await response.text();
      const payload = parseOllamaChatResponse(rawBody);

      if (!response.ok) {
        throw new AiProviderRequestError(
          payload.error?.trim() || response.statusText || `Ollama request failed with status ${response.status}.`,
          response.status
        );
      }

      const content = payload.message?.content?.trim();
      if (!content) {
        throw new Error("Ollama did not return a structured enrichment payload.");
      }

      return aiRecommendationSchema.parse(JSON.parse(normalizeJsonResponse(content)));
    } catch (error) {
      if (error instanceof AiProviderRequestError || error instanceof z.ZodError) {
        throw error;
      }

      if (error instanceof SyntaxError) {
        throw new Error("Ollama returned invalid JSON for node enrichment.");
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AiProviderRequestError(
          `Ollama request timed out after ${this.timeoutMs}ms.`,
          408,
          "APIConnectionTimeoutError"
        );
      }

      if (error instanceof Error) {
        throw new AiProviderRequestError(error.message, undefined, "APIConnectionError");
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function parseOllamaChatResponse(rawBody: string): OllamaChatResponse {
  try {
    return JSON.parse(rawBody) as OllamaChatResponse;
  } catch {
    throw new Error("Ollama returned an invalid JSON response.");
  }
}

function normalizeJsonResponse(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/u, "")
    .trim();
}

function resolveOllamaChatUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/u, "");

  if (normalized.endsWith("/api/chat")) {
    return normalized;
  }

  if (normalized.endsWith("/api")) {
    return `${normalized}/chat`;
  }

  return `${normalized}/api/chat`;
}

function chooseBranchKind(
  candidate: AiContextPayload["validParentCandidates"][number],
  score: number,
  targetClassification: Classification
): BranchKind | null {
  if (targetClassification === "counter") {
    if (candidate.nextAvailableSideSlot) {
      return "side";
    }

    return candidate.allowsMain ? "main" : null;
  }

  if (targetClassification === "question") {
    if (candidate.allowsMain && score >= SIMILARITY_THRESHOLD) {
      return "main";
    }

    if (candidate.nextAvailableSideSlot) {
      return "side";
    }

    return candidate.allowsMain ? "main" : null;
  }

  if (candidate.allowsMain && score >= LOCAL_MAIN_CONTINUATION_THRESHOLD) {
    return "main";
  }

  if (candidate.nextAvailableSideSlot) {
    return "side";
  }

  if (candidate.allowsMain) {
    return "main";
  }

  return null;
}

function rankCandidates(context: AiContextPayload): RankedCandidateEntry[] {
  const nodeById = new Map(context.currentGraph.map((node) => [node.nodeId, node]));
  const maxNodeId = context.currentGraph.reduce((highest, node) => Math.max(highest, node.nodeId), 1);
  const childCounts = new Map<number, number>();
  const targetClassification = getDefaultClassification(context.targetNode.text);

  for (const node of context.currentGraph) {
    if (node.parentId !== null) {
      childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
    }
  }

  return context.validParentCandidates
    .map((candidate) => {
      const node = nodeById.get(candidate.nodeId);
      if (!node) {
        return null;
      }

      return {
        candidate,
        node,
        score: scoreCandidate(
          context,
          node,
          candidate,
          targetClassification,
          maxNodeId,
          childCounts
        )
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => right.score - left.score || right.node.nodeId - left.node.nodeId);
}

function buildOllamaPromptPayload(context: AiContextPayload) {
  if (context.targetNode.nodeId === 1) {
    return {
      streamId: context.streamId,
      targetNode: context.targetNode,
      currentGraph: [],
      validParentCandidates: [],
      candidateSummaries: [],
      heuristicTopChoice: {
        parentNodeId: null,
        branchKind: "main",
        classification: getDefaultClassification(context.targetNode.text)
      }
    };
  }

  const rankedCandidates = rankCandidates(context).slice(0, OLLAMA_MAX_PARENT_CANDIDATES);
  const selectedNodeIds = collectOllamaGraphNodeIds(context.currentGraph, rankedCandidates.map((entry) => entry.node.nodeId));
  const selectedNodeIdSet = new Set(selectedNodeIds);
  const targetClassification = getDefaultClassification(context.targetNode.text);
  const heuristicTopChoice = rankedCandidates
    .map((entry) => {
      const branchKind = chooseBranchKind(entry.candidate, entry.score, targetClassification);
      if (!branchKind) {
        return null;
      }

      return {
        parentNodeId: entry.node.nodeId,
        branchKind,
        classification: resolveClassification(context.targetNode.text, branchKind)
      };
    })
    .find((entry) => entry !== null);

  return {
    streamId: context.streamId,
    targetNode: context.targetNode,
    currentGraph: context.currentGraph.filter((node) => selectedNodeIdSet.has(node.nodeId)),
    validParentCandidates: rankedCandidates.map((entry) => entry.candidate),
    candidateSummaries: rankedCandidates.map((entry) => ({
      nodeId: entry.node.nodeId,
      text: entry.node.text,
      classification: entry.node.classification,
      parentId: entry.node.parentId,
      branchType: entry.node.branchType,
      allowsMain: entry.candidate.allowsMain,
      nextAvailableSideSlot: entry.candidate.nextAvailableSideSlot,
      heuristicScore: entry.score
    })),
    heuristicTopChoice
  };
}

function collectOllamaGraphNodeIds(
  currentGraph: AiContextPayload["currentGraph"],
  candidateNodeIds: number[]
): number[] {
  const nodeById = new Map(currentGraph.map((node) => [node.nodeId, node]));
  const orderedNodeIds: number[] = [];
  const seen = new Set<number>();

  const addNodeId = (nodeId: number | null | undefined) => {
    if (nodeId === null || nodeId === undefined || seen.has(nodeId)) {
      return;
    }

    seen.add(nodeId);
    orderedNodeIds.push(nodeId);
  };

  for (const candidateNodeId of candidateNodeIds) {
    const ancestry: number[] = [];
    let currentNodeId: number | null | undefined = candidateNodeId;

    while (currentNodeId !== null && currentNodeId !== undefined) {
      ancestry.unshift(currentNodeId);
      currentNodeId = nodeById.get(currentNodeId)?.parentId;
    }

    for (const ancestorNodeId of ancestry) {
      addNodeId(ancestorNodeId);
    }
  }

  const recentNodeIds = [...currentGraph]
    .sort((left, right) => right.nodeId - left.nodeId)
    .map((node) => node.nodeId);
  for (const nodeId of recentNodeIds) {
    if (orderedNodeIds.length >= OLLAMA_MAX_GRAPH_NODES) {
      break;
    }

    addNodeId(nodeId);
  }

  return orderedNodeIds.slice(0, OLLAMA_MAX_GRAPH_NODES);
}

function resolveClassification(text: string, branchKind: BranchKind): Classification {
  const base = getDefaultClassification(text);
  if (base !== "claim") {
    return base;
  }

  return branchKind === "main" ? "support" : "counter";
}

function toConfidence(score: number, branchKind: BranchKind): number {
  const baseline = branchKind === "main" ? 0.62 : 0.48;
  const max = branchKind === "main" ? 0.96 : 0.84;
  const confidence = Math.min(max, baseline + score * 0.35);
  return Math.round(confidence * 10_000) / 10_000;
}

function buildRationale(
  node: AiContextPayload["currentGraph"][number],
  score: number,
  branchKind: BranchKind,
  targetClassification: Classification
): string {
  if (branchKind === "main" && score >= SIMILARITY_THRESHOLD) {
    return `Local heuristic matched this most closely with #${node.nodeId} and kept it on the main line.`;
  }

  if (branchKind === "main") {
    return `Local heuristic treated #${node.nodeId} as the best continuation based on topic overlap and branch availability.`;
  }

  if (targetClassification === "counter") {
    return `Local heuristic treated #${node.nodeId} as the closest claim to challenge and attached this as a side branch.`;
  }

  return `Local heuristic attached this beside #${node.nodeId} because it fit better as a side thread than a main-line continuation.`;
}

function scoreCandidate(
  context: AiContextPayload,
  node: AiContextPayload["currentGraph"][number],
  candidate: AiContextPayload["validParentCandidates"][number],
  targetClassification: Classification,
  maxNodeId: number,
  childCounts: Map<number, number>
): number {
  const baseScore = deterministicScore(context.streamId, node.nodeId, context.targetNode.text, node.text);
  const topicality = topicalOverlap(context.targetNode.text, node.text);
  const recency = maxNodeId <= 1 ? 0 : node.nodeId / maxNodeId;
  const hasChildren = (childCounts.get(node.nodeId) ?? 0) > 0;

  let score = baseScore * 0.72 + topicality * 0.16 + recency * 0.05;

  if (!hasChildren) {
    score += 0.03;
  }

  if (targetClassification === "support" || targetClassification === "claim") {
    if (candidate.allowsMain) {
      score += 0.08;
    }

    if (node.branchType === "main") {
      score += 0.04;
    }
  }

  if (targetClassification === "counter") {
    if (candidate.nextAvailableSideSlot) {
      score += 0.1;
    }

    if (node.branchType === "main") {
      score += 0.03;
    }
  }

  if (targetClassification === "question" && candidate.nextAvailableSideSlot && !candidate.allowsMain) {
    score += 0.04;
  }

  const candidateClassification = node.classification ?? "claim";
  if (isClassificationCompatible(targetClassification, candidateClassification)) {
    score += 0.06;
  }

  return Math.min(1, Math.round(score * 10_000) / 10_000);
}

function topicalOverlap(targetText: string, candidateText: string): number {
  const targetTokens = tokenizeText(targetText);
  const candidateTokens = tokenizeText(candidateText);

  if (targetTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const candidateSet = new Set(candidateTokens);
  const overlap = targetTokens.filter((token) => candidateSet.has(token));

  if (overlap.length === 0) {
    return 0;
  }

  const weightedOverlap = overlap.reduce((total, token) => total + (token.length >= 6 ? 1.25 : 1), 0);
  const normalizer = targetTokens.reduce((total, token) => total + (token.length >= 6 ? 1.25 : 1), 0);

  return normalizer === 0 ? 0 : weightedOverlap / normalizer;
}

function isClassificationCompatible(target: Classification, candidate: Classification): boolean {
  if (target === "support") {
    return candidate === "claim" || candidate === "support" || candidate === "question";
  }

  if (target === "counter") {
    return candidate === "claim" || candidate === "support" || candidate === "question";
  }

  if (target === "question") {
    return candidate !== "question";
  }

  return candidate === "claim" || candidate === "support";
}

export function createAiService(options: {
  provider?: AiProvider;
  model: string;
  timeoutMs: number;
  openAiApiKey?: string;
  ollamaBaseUrl?: string;
  ollamaApiKey?: string;
  fetchImpl?: typeof fetch;
}): AiService {
  if (options.provider === "local" || options.provider === undefined) {
    return new LocalAiService(options.model);
  }

  if (options.provider === "openai") {
    if (!options.openAiApiKey) {
      return new DisabledAiService("OPENAI_API_KEY is not configured.");
    }

    const client = new OpenAI({
      apiKey: options.openAiApiKey
    });

    return new OpenAiService(client, options.model, options.timeoutMs);
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("Fetch API is not available for Ollama integration.");
  }

  return new OllamaAiService(
    fetchImpl,
    options.model,
    options.timeoutMs,
    options.ollamaBaseUrl ?? "http://127.0.0.1:11434",
    options.ollamaApiKey
  );
}
