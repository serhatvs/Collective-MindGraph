import { config as loadDotEnv } from "dotenv";
import { createPublicClient, http } from "viem";

loadDotEnv({ path: "../../.env" });
loadDotEnv();

const apiBaseUrl = process.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const rpcUrl = process.env.MONAD_RPC_URL;
const pollIntervalMs = 1_000;
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 45_000);

if (!rpcUrl) {
  throw new Error("MONAD_RPC_URL is required for the smoke test.");
}

const publicClient = createPublicClient({
  transport: http(rpcUrl)
});

interface StreamRecord {
  id: string;
  createdTxHash: `0x${string}`;
}

interface NodeRecord {
  nodeId: number;
  aiStatus: "pending" | "completed" | "failed" | "accepted_heuristic";
}

interface StreamDetail {
  nodes: NodeRecord[];
  ai: {
    commitBlocked: boolean;
    pendingCount: number;
    failedCount: number;
  };
  snapshots: Array<{
    snapshotIndex: number;
    txHash: `0x${string}`;
  }>;
}

interface CommitResponse {
  committed: boolean;
  skippedReason?: string;
  snapshot?: {
    snapshotIndex: number;
    txHash: `0x${string}`;
  };
}

async function main() {
  await request("/health");

  const metadata = `smoke-${new Date().toISOString()}`;
  const streamResponse = await request<{ stream: StreamRecord }>("/streams", {
    method: "POST",
    body: JSON.stringify({ metadata })
  });
  const stream = streamResponse.stream;
  await assertSuccessfulReceipt(stream.createdTxHash, "createStream");

  const nodeResponse = await request<{ node: NodeRecord }>(`/streams/${stream.id}/nodes`, {
    method: "POST",
    body: JSON.stringify({
      text: `Smoke test node ${new Date().toISOString()}`
    })
  });

  const node = nodeResponse.node;
  await waitForCommitableState(stream.id, node.nodeId);

  const commitResponse = await request<CommitResponse>(`/streams/${stream.id}/commit`, {
    method: "POST",
    body: JSON.stringify({ reason: "manual" })
  });

  if (!commitResponse.committed || !commitResponse.snapshot) {
    throw new Error(`Commit failed during smoke test: ${commitResponse.skippedReason ?? "unknown reason"}`);
  }

  await assertSuccessfulReceipt(commitResponse.snapshot.txHash, "commitSnapshot");

  const detail = await request<StreamDetail>(`/streams/${stream.id}`);
  const latestSnapshot = detail.snapshots[0];
  if (!latestSnapshot || latestSnapshot.snapshotIndex !== 1) {
    throw new Error("Smoke test did not produce the expected first snapshot.");
  }

  console.log(`Smoke test passed for stream ${stream.id}`);
  console.log(`createStream tx: ${stream.createdTxHash}`);
  console.log(`commitSnapshot tx: ${commitResponse.snapshot.txHash}`);
}

async function waitForCommitableState(streamId: string, nodeId: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const detail = await request<StreamDetail>(`/streams/${streamId}`);
    const node = detail.nodes.find((entry) => entry.nodeId === nodeId);
    if (!node) {
      throw new Error(`Smoke test node ${nodeId} is missing from stream ${streamId}.`);
    }

    if (node.aiStatus === "failed") {
      await request(`/streams/${streamId}/nodes/${nodeId}/accept-heuristic`, {
        method: "POST"
      });
      continue;
    }

    const failedNodes = detail.nodes.filter((entry) => entry.aiStatus === "failed");
    if (failedNodes.length > 0) {
      for (const failedNode of failedNodes) {
        await request(`/streams/${streamId}/nodes/${failedNode.nodeId}/accept-heuristic`, {
          method: "POST"
        });
      }
      continue;
    }

    if (!detail.ai.commitBlocked) {
      return;
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting ${timeoutMs}ms for stream ${streamId} to become committable.`);
}

async function assertSuccessfulReceipt(txHash: `0x${string}`, label: string) {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`${label} transaction ${txHash} was mined with status ${receipt.status}.`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const hasBody = init?.body !== undefined && init.body !== null;
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;

  if (hasBody && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `Request to ${path} failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
