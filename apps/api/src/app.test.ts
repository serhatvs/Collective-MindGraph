import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { DatabaseClient } from "./db/client.js";
import { EnrichmentService } from "./services/enrichmentService.js";
import { StreamLock } from "./services/streamLock.js";
import { createFakeAiService, createFakeChainService, createTempDatabasePath } from "./test-utils.js";

function setup(
  aiHandler?: Parameters<typeof createFakeAiService>[0]
) {
  const temp = createTempDatabasePath();
  const db = new DatabaseClient(temp.path);
  const chainService = createFakeChainService();
  const aiService = createFakeAiService(aiHandler);
  const streamLock = new StreamLock();
  const enrichmentService = new EnrichmentService(db, aiService, streamLock);

  return {
    temp,
    db,
    chainService,
    aiService,
    streamLock,
    enrichmentService
  };
}

async function processAllDueJobs(enrichmentService: EnrichmentService, streamId: string, maxIterations = 10) {
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const dueJobs = enrichmentService.getDueJobs(10).filter((job) => job.streamId === streamId);
    if (dueJobs.length === 0) {
      break;
    }

    for (const job of dueJobs) {
      await enrichmentService.processJob(job);
    }
  }
}

async function exhaustNodeJob(db: DatabaseClient, enrichmentService: EnrichmentService, streamId: string, nodeId: number, maxIterations = 6) {
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const job = db.getEnrichmentJob(streamId, nodeId);
    if (!job || job.status === "completed" || job.status === "failed") {
      break;
    }

    await enrichmentService.processJob(job);
  }
}

describe("API integration", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      await cleanup?.();
    }
  });

  it("creates streams in the database", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup();
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: false
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    const response = await app.inject({
      method: "POST",
      url: "/streams",
      payload: {}
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().stream.id).toBe("1");
  });

  it("creates nodes in pending AI state and blocks commit until enrichment completes", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup();
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: false
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    await app.inject({ method: "POST", url: "/streams", payload: {} });
    const addNodeResponse = await app.inject({
      method: "POST",
      url: "/streams/1/nodes",
      payload: { text: "Root discussion node" }
    });

    expect(addNodeResponse.statusCode).toBe(201);
    expect(addNodeResponse.json().node.aiStatus).toBe("pending");

    const autoCommitResponse = await app.inject({
      method: "POST",
      url: "/streams/1/commit",
      payload: { reason: "auto" }
    });

    expect(autoCommitResponse.statusCode).toBe(200);
    expect(autoCommitResponse.json().skippedReason).toBe("ai_pending");
  });

  it("rejects empty node text", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup();
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: false
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    await app.inject({ method: "POST", url: "/streams", payload: {} });

    const response = await app.inject({
      method: "POST",
      url: "/streams/1/nodes",
      payload: { text: "   " }
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects node 51", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup();
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: false
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    await app.inject({ method: "POST", url: "/streams", payload: {} });

    for (let index = 0; index < 50; index += 1) {
      const addResponse = await app.inject({
        method: "POST",
        url: "/streams/1/nodes",
        payload: { text: `node ${index}` }
      });

      expect(addResponse.statusCode).toBe(201);
    }

    const overflow = await app.inject({
      method: "POST",
      url: "/streams/1/nodes",
      payload: { text: "overflow" }
    });

    expect(overflow.statusCode).toBe(409);
    expect(overflow.json().code).toBe("NODE_LIMIT_REACHED");
  });

  it("rejects root overrides", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup();
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: false
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    await app.inject({ method: "POST", url: "/streams", payload: {} });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "root node" } });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "second node" } });

    const response = await app.inject({
      method: "PATCH",
      url: "/streams/1/nodes/1",
      payload: { parentId: 2, branchKind: "side" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("ROOT_NODE_IMMUTABLE");
  });

  it("rejects cycle creation", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup();
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: false
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    await app.inject({ method: "POST", url: "/streams", payload: {} });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "root node" } });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "tax policy" } });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "tax policy wages" } });

    const response = await app.inject({
      method: "PATCH",
      url: "/streams/1/nodes/2",
      payload: { parentId: 3, branchKind: "side" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("INVALID_PARENT");
  });

  it("updates node placement and classification after AI enrichment", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup((context) => {
      if (context.targetNode.nodeId === 1) {
        return {
          parentNodeId: null,
          branchKind: "main",
          classification: "claim",
          confidence: 0.95,
          rationale: "Root stays on the main line."
        };
      }

      return {
        parentNodeId: 1,
        branchKind: "main",
        classification: "support",
        confidence: 0.81,
        rationale: "This extends the main position."
      };
    });
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: false
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    await app.inject({ method: "POST", url: "/streams", payload: {} });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "root node" } });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "supporting point" } });
    await processAllDueJobs(enrichmentService, "1");

    const detail = await app.inject({ method: "GET", url: "/streams/1" });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().nodes[1].branchType).toBe("main");
    expect(detail.json().nodes[1].classification).toBe("support");
    expect(detail.json().nodes[1].aiStatus).toBe("completed");
  });

  it("does not let AI clobber a manual override", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup((context) => {
      if (context.targetNode.nodeId === 1) {
        return {
          parentNodeId: null,
          branchKind: "main",
          classification: "claim",
          confidence: 0.95,
          rationale: "Root stays on the main line."
        };
      }

      return {
        parentNodeId: 1,
        branchKind: "side",
        classification: "counter",
        confidence: 0.88,
        rationale: "AI prefers a side branch under the root."
      };
    });
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: false
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    await app.inject({ method: "POST", url: "/streams", payload: {} });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "root node" } });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "node two" } });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "node three" } });

    const overrideResponse = await app.inject({
      method: "PATCH",
      url: "/streams/1/nodes/3",
      payload: { parentId: 2, branchKind: "side" }
    });

    expect(overrideResponse.statusCode).toBe(200);
    await processAllDueJobs(enrichmentService, "1");

    const detail = await app.inject({ method: "GET", url: "/streams/1" });
    const thirdNode = detail.json().nodes[2];
    expect(thirdNode.parentId).toBe(2);
    expect(thirdNode.placementSource).toBe("manual");
    expect(thirdNode.classification).toBe("counter");
  });

  it("rejects manual commit while AI is pending", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup();
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: false
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    await app.inject({ method: "POST", url: "/streams", payload: {} });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "root node" } });

    const manualCommit = await app.inject({
      method: "POST",
      url: "/streams/1/commit",
      payload: { reason: "manual" }
    });

    expect(manualCommit.statusCode).toBe(409);
    expect(manualCommit.json().code).toBe("AI_ENRICHMENT_BLOCKING_COMMIT");
  });

  it("allows heuristic acceptance after AI failure and then commits", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup(async () => {
      throw new Error("Simulated AI failure");
    });
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: false
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    await app.inject({ method: "POST", url: "/streams", payload: {} });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "root node" } });
    await exhaustNodeJob(db, enrichmentService, "1", 1);

    const detailAfterFailure = await app.inject({ method: "GET", url: "/streams/1" });
    expect(detailAfterFailure.json().ai.failedCount).toBe(1);
    expect(detailAfterFailure.json().nodes[0].aiStatus).toBe("failed");

    const acceptResponse = await app.inject({
      method: "POST",
      url: "/streams/1/nodes/1/accept-heuristic"
    });

    expect(acceptResponse.statusCode).toBe(200);
    expect(acceptResponse.json().node.aiStatus).toBe("accepted_heuristic");

    const finalCommit = await app.inject({
      method: "POST",
      url: "/streams/1/commit",
      payload: { reason: "final" }
    });

    expect(finalCommit.statusCode).toBe(200);
    expect(finalCommit.json().stream.status).toBe("ended");
  });

  it("retries transient provider failures such as Ollama warmup responses", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup(async () => {
      throw Object.assign(new Error("Ollama is warming up."), {
        status: 503,
        name: "AiProviderError"
      });
    });
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: false
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    await app.inject({ method: "POST", url: "/streams", payload: {} });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "root node" } });

    const job = db.getEnrichmentJob("1", 1);
    expect(job).not.toBeNull();
    await enrichmentService.processJob(job!);

    const retriedJob = db.getEnrichmentJob("1", 1);
    const node = db.getNode("1", 1);

    expect(retriedJob?.status).toBe("retrying");
    expect(retriedJob?.attemptCount).toBe(1);
    expect(retriedJob?.lastError).toBe("Ollama is warming up.");
    expect(node?.aiStatus).toBe("pending");
  });

  it("fails non-transient provider errors without retrying", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup(async () => {
      throw Object.assign(new Error("Prompt schema rejected by provider."), {
        status: 400,
        name: "AiProviderError"
      });
    });
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: false
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    await app.inject({ method: "POST", url: "/streams", payload: {} });
    await app.inject({ method: "POST", url: "/streams/1/nodes", payload: { text: "root node" } });

    const job = db.getEnrichmentJob("1", 1);
    expect(job).not.toBeNull();
    await enrichmentService.processJob(job!);

    const failedJob = db.getEnrichmentJob("1", 1);
    const node = db.getNode("1", 1);

    expect(failedJob?.status).toBe("failed");
    expect(failedJob?.attemptCount).toBe(1);
    expect(failedJob?.lastError).toBe("Prompt schema rejected by provider.");
    expect(node?.aiStatus).toBe("failed");
  });

  it("allows multiple configured origins including Vercel preview wildcards", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup();
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: "https://collective-mindgraph.vercel.app,https://collective-mindgraph-*.vercel.app"
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "https://collective-mindgraph-git-main-victus.vercel.app"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://collective-mindgraph-git-main-victus.vercel.app");
  });

  it("rejects origins outside the configured allow-list", async () => {
    const { temp, db, chainService, aiService, streamLock, enrichmentService } = setup();
    const app = await buildApp({
      db,
      chainService,
      aiService,
      streamLock,
      enrichmentService,
      logger: false,
      corsOrigin: "https://collective-mindgraph.vercel.app,https://collective-mindgraph-*.vercel.app"
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
      temp.cleanup();
    });

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "https://different-project.vercel.app"
      }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe("INTERNAL_SERVER_ERROR");
  });

});
