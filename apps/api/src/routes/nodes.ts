import { createNodeRequestSchema, updateNodeRequestSchema } from "@cmg/shared";
import type { FastifyInstance } from "fastify";

import { AppError } from "../lib/errors.js";
import type { EnrichmentService } from "../services/enrichmentService.js";
import type { GraphService } from "../services/graphService.js";
import type { StreamLock } from "../services/streamLock.js";

interface NodeRouteDeps {
  graphService: GraphService;
  enrichmentService: EnrichmentService;
  streamLock: StreamLock;
}

export function registerNodeRoutes(app: FastifyInstance, deps: NodeRouteDeps) {
  app.post<{ Params: { id: string } }>("/streams/:id/nodes", async (request, reply) => {
    const parsed = createNodeRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, "INVALID_REQUEST", "Invalid node payload.", parsed.error.flatten());
    }

    const node = await deps.streamLock.runExclusive(request.params.id, async () => {
      const createdNode = deps.graphService.addNode(request.params.id, parsed.data.text.trim());
      app.log.info({ streamId: request.params.id, nodeId: createdNode.nodeId }, "node added");
      return createdNode;
    });

    reply.code(201);
    return { node };
  });

  app.patch<{ Params: { id: string; nodeId: string } }>("/streams/:id/nodes/:nodeId", async (request) => {
    const parsed = updateNodeRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, "INVALID_REQUEST", "Invalid override payload.", parsed.error.flatten());
    }

    const numericNodeId = Number.parseInt(request.params.nodeId, 10);
    if (!Number.isInteger(numericNodeId) || numericNodeId <= 0) {
      throw new AppError(400, "INVALID_NODE_ID", "Node id must be a positive integer.");
    }

    const node = await deps.streamLock.runExclusive(request.params.id, async () => {
      const updatedNode = deps.graphService.overrideNode(
        request.params.id,
        numericNodeId,
        parsed.data.parentId,
        parsed.data.branchKind
      );
      app.log.info(
        {
          streamId: request.params.id,
          nodeId: updatedNode.nodeId,
          parentId: updatedNode.parentId,
          branchType: updatedNode.branchType
        },
        "node overridden"
      );
      return updatedNode;
    });

    return { node };
  });

  app.post<{ Params: { id: string; nodeId: string } }>("/streams/:id/nodes/:nodeId/accept-heuristic", async (request) => {
    const numericNodeId = Number.parseInt(request.params.nodeId, 10);
    if (!Number.isInteger(numericNodeId) || numericNodeId <= 0) {
      throw new AppError(400, "INVALID_NODE_ID", "Node id must be a positive integer.");
    }

    const node = await deps.streamLock.runExclusive(request.params.id, async () => {
      const updatedNode = deps.enrichmentService.acceptHeuristic(request.params.id, numericNodeId);
      app.log.info(
        {
          streamId: request.params.id,
          nodeId: updatedNode.nodeId
        },
        "heuristic accepted"
      );
      return updatedNode;
    });

    return { node };
  });
}
