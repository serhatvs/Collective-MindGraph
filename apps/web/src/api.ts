import type {
  BranchKind,
  CommitSkippedReason,
  NodeRecord,
  SnapshotReason,
  StreamDetail,
  StreamRecord
} from "@cmg/shared";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

interface ApiErrorShape {
  code?: string;
  message?: string;
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  const hasBody = init?.body !== undefined && init.body !== null;
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;

  if (hasBody && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: buildHeaders(init)
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ApiErrorShape | null;
    throw new Error(error?.message ?? `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function createStream(metadata?: string): Promise<StreamRecord> {
  const response = await request<{ stream: StreamRecord }>("/streams", {
    method: "POST",
    body: JSON.stringify(metadata ? { metadata } : {})
  });

  if (!response) {
    throw new Error("Failed to create stream.");
  }

  return response.stream;
}

export async function getStreamDetail(streamId: string): Promise<StreamDetail> {
  const response = await request<StreamDetail>(`/streams/${streamId}`);
  if (!response) {
    throw new Error("Stream not found.");
  }

  return response;
}

export async function addNode(streamId: string, text: string) {
  const response = await request<{ node: NodeRecord }>(`/streams/${streamId}/nodes`, {
    method: "POST",
    body: JSON.stringify({ text })
  });

  if (!response) {
    throw new Error("Failed to add node.");
  }

  return response.node;
}

export async function overrideNode(streamId: string, nodeId: number, payload: { parentId: number; branchKind: BranchKind }) {
  const response = await request<{ node: NodeRecord }>(`/streams/${streamId}/nodes/${nodeId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });

  if (!response) {
    throw new Error("Failed to override node.");
  }

  return response.node;
}

export async function acceptHeuristic(streamId: string, nodeId: number) {
  const response = await request<{ node: NodeRecord }>(`/streams/${streamId}/nodes/${nodeId}/accept-heuristic`, {
    method: "POST"
  });

  if (!response) {
    throw new Error("Failed to accept heuristic placement.");
  }

  return response.node;
}

export async function commitStream(streamId: string, reason: SnapshotReason) {
  return request<{
    committed: boolean;
    skippedReason?: CommitSkippedReason;
  }>(`/streams/${streamId}/commit`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}
