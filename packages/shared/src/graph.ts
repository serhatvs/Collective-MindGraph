import {
  CANDIDATE_WINDOW,
  type Classification,
  type BranchKind,
  type BranchType,
  type NodeRecord,
  type PlacementSuggestion,
  SIMILARITY_THRESHOLD,
  type ValidParentCandidate
} from "./types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with"
]);

function normalizeToken(token: string): string {
  let normalized = token.toLowerCase();

  if (normalized.endsWith("ies") && normalized.length > 4) {
    normalized = `${normalized.slice(0, -3)}y`;
  } else if (normalized.endsWith("ing") && normalized.length > 5) {
    normalized = normalized.slice(0, -3);
  } else if (normalized.endsWith("ed") && normalized.length > 4) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.endsWith("es") && normalized.length > 4) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.endsWith("s") && normalized.length > 3) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

function getOrderedTokens(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

  const normalized = matches
    .map((token) => normalizeToken(token))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

  return normalized.length > 0 ? normalized : matches.map((token) => normalizeToken(token));
}

export function tokenizeText(text: string): string[] {
  return Array.from(new Set(getOrderedTokens(text)));
}

export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

export function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = tokenizeText(left);
  const rightTokens = tokenizeText(right);

  if (leftTokens.length === 0 && rightTokens.length === 0) {
    return 1;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);

  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function orderedBigramSet(tokens: string[]): Set<string> {
  const bigrams = new Set<string>();

  for (let index = 0; index < tokens.length - 1; index += 1) {
    bigrams.add(`${tokens[index]} ${tokens[index + 1]}`);
  }

  return bigrams;
}

function setIntersectionSize<T>(left: Set<T>, right: Set<T>): number {
  let intersection = 0;

  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }

  return intersection;
}

export function deterministicScore(
  streamId: string,
  candidateNodeId: number,
  newText: string,
  candidateText: string
): number {
  const leftTokens = tokenizeText(newText);
  const rightTokens = tokenizeText(candidateText);
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = setIntersectionSize(leftSet, rightSet);
  const union = new Set([...leftSet, ...rightSet]).size;
  const jaccard = union === 0 ? 0 : intersection / union;
  const coverage = Math.min(leftSet.size, rightSet.size) === 0 ? 0 : intersection / Math.min(leftSet.size, rightSet.size);
  const longTokenOverlap = Math.max(leftTokens.length, rightTokens.length) === 0
    ? 0
    : [...leftSet].filter((token) => token.length >= 5 && rightSet.has(token)).length / Math.max(leftTokens.length, rightTokens.length);
  const leftBigrams = orderedBigramSet(getOrderedTokens(newText));
  const rightBigrams = orderedBigramSet(getOrderedTokens(candidateText));
  const bigramUnion = new Set([...leftBigrams, ...rightBigrams]).size;
  const bigramScore = bigramUnion === 0 ? 0 : setIntersectionSize(leftBigrams, rightBigrams) / bigramUnion;
  const salt = (fnv1a32(`${streamId}:${candidateNodeId}:${newText}`) % 1000) / 100000;
  const score = Math.min(
    1,
    jaccard * 0.55 +
    coverage * 0.25 +
    bigramScore * 0.12 +
    longTokenOverlap * 0.08 +
    salt
  );
  return Math.round(score * 10_000) / 10_000;
}

export function getChildren(nodes: NodeRecord[], parentId: number): NodeRecord[] {
  return nodes.filter((node) => node.parentId === parentId);
}

export function getMainChild(nodes: NodeRecord[], parentId: number, ignoreNodeId?: number): NodeRecord | undefined {
  return nodes.find(
    (node) => node.parentId === parentId && node.branchType === "main" && node.nodeId !== ignoreNodeId
  );
}

export function getSideChildren(
  nodes: NodeRecord[],
  parentId: number,
  ignoreNodeId?: number
): Partial<Record<"side1" | "side2", NodeRecord>> {
  const sideChildren = nodes.filter(
    (node) =>
      node.parentId === parentId &&
      (node.branchType === "side1" || node.branchType === "side2") &&
      node.nodeId !== ignoreNodeId
  );

  return Object.fromEntries(sideChildren.map((node) => [node.branchType, node])) as Partial<
    Record<"side1" | "side2", NodeRecord>
  >;
}

export function getAvailableSideSlot(
  nodes: NodeRecord[],
  parentId: number,
  ignoreNodeId?: number
): "side1" | "side2" | null {
  const occupied = getSideChildren(nodes, parentId, ignoreNodeId);

  if (!occupied.side1) {
    return "side1";
  }

  if (!occupied.side2) {
    return "side2";
  }

  return null;
}

export function collectDescendantIds(nodes: NodeRecord[], nodeId: number): Set<number> {
  const descendants = new Set<number>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }

    for (const node of nodes) {
      if (node.parentId === current && !descendants.has(node.nodeId)) {
        descendants.add(node.nodeId);
        queue.push(node.nodeId);
      }
    }
  }

  return descendants;
}

export function isValidParentCandidate(nodes: NodeRecord[], nodeId: number, parentId: number): boolean {
  if (nodeId === parentId) {
    return false;
  }

  return !collectDescendantIds(nodes, nodeId).has(parentId);
}

export function resolveBranchTypeForOverride(
  nodes: NodeRecord[],
  node: NodeRecord,
  parentId: number,
  branchKind: BranchKind
): BranchType | null {
  if (branchKind === "main") {
    const existingMainChild = getMainChild(nodes, parentId, node.nodeId);
    return existingMainChild ? null : "main";
  }

  if (
    node.parentId === parentId &&
    (node.branchType === "side1" || node.branchType === "side2")
  ) {
    return node.branchType;
  }

  return getAvailableSideSlot(nodes, parentId, node.nodeId);
}

export function getValidParentCandidates(nodes: NodeRecord[], node: NodeRecord): ValidParentCandidate[] {
  if (node.nodeId === 1) {
    return [];
  }

  const invalidParentIds = collectDescendantIds(nodes, node.nodeId);
  invalidParentIds.add(node.nodeId);

  return nodes
    .filter((candidate) => !invalidParentIds.has(candidate.nodeId))
    .map((candidate) => ({
      nodeId: candidate.nodeId,
      allowsMain: !getMainChild(nodes, candidate.nodeId, node.nodeId),
      nextAvailableSideSlot: getAvailableSideSlot(nodes, candidate.nodeId, node.nodeId)
    }));
}

export function getDefaultClassification(nodeText: string): Classification {
  const normalized = nodeText.toLowerCase();
  const hasQuestionSignal =
    normalized.includes("?") ||
    /^(who|what|when|where|why|how|is|are|can|should|could|would|do|does|did)\b/.test(normalized);
  if (hasQuestionSignal) {
    return "question";
  }

  if (/\b(but|however|instead|although|though|not|never|no|wrong|disagree|cannot|can't|won't)\b/.test(normalized)) {
    return "counter";
  }

  if (/\b(because|therefore|thus|also|agree|supports?|evidence|for example|for instance)\b/.test(normalized)) {
    return "support";
  }

  return "claim";
}

export function suggestPlacement(existingNodes: NodeRecord[], streamId: string, text: string): PlacementSuggestion | null {
  if (existingNodes.length === 0) {
    return {
      parentId: null,
      branchType: "main",
      score: 1
    };
  }

  const candidates = [...existingNodes]
    .sort((left, right) => right.nodeId - left.nodeId)
    .slice(0, CANDIDATE_WINDOW)
    .map((candidate) => ({
      candidate,
      score: deterministicScore(streamId, candidate.nodeId, text, candidate.text)
    }))
    .sort((left, right) => right.score - left.score || right.candidate.nodeId - left.candidate.nodeId);

  for (const { candidate, score } of candidates) {
    const mainChild = getMainChild(existingNodes, candidate.nodeId);
    const sideSlot = getAvailableSideSlot(existingNodes, candidate.nodeId);

    if (score >= SIMILARITY_THRESHOLD && !mainChild) {
      return {
        parentId: candidate.nodeId,
        branchType: "main",
        score
      };
    }

    if (sideSlot) {
      return {
        parentId: candidate.nodeId,
        branchType: sideSlot,
        score
      };
    }

    if (!mainChild) {
      return {
        parentId: candidate.nodeId,
        branchType: "main",
        score
      };
    }
  }

  return null;
}

export function getMainTrunkNodeIds(nodes: NodeRecord[]): Set<number> {
  const trunk = new Set<number>();
  const byParentId = new Map<number, NodeRecord>();

  for (const node of nodes) {
    if (node.parentId !== null && node.branchType === "main") {
      byParentId.set(node.parentId, node);
    }
  }

  let currentId = 1;
  while (true) {
    const current = nodes.find((node) => node.nodeId === currentId);
    if (!current) {
      break;
    }

    trunk.add(currentId);
    const mainChild = byParentId.get(currentId);
    if (!mainChild) {
      break;
    }

    currentId = mainChild.nodeId;
  }

  return trunk;
}
