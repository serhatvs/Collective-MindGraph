import {
  createStreamRequestSchema,
  DEFAULT_STREAM_METADATA,
  type StreamRecord
} from "@cmg/shared";
import type { FastifyInstance } from "fastify";

import type { DatabaseClient } from "../db/client.js";
import { AppError } from "../lib/errors.js";
import type { ChainService } from "../services/chainService.js";
import type { SnapshotService } from "../services/snapshotService.js";

interface StreamRouteDeps {
  db: DatabaseClient;
  chainService: ChainService;
  snapshotService: SnapshotService;
}

export function registerStreamRoutes(app: FastifyInstance, deps: StreamRouteDeps) {
  app.post("/streams", async (request, reply) => {
    const parsed = createStreamRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, "INVALID_REQUEST", "Invalid stream payload.", parsed.error.flatten());
    }

    const metadata = parsed.data.metadata?.trim() || DEFAULT_STREAM_METADATA;
    const result = await deps.chainService.createStream(metadata);
    const stream: StreamRecord = {
      id: result.streamId,
      metadata,
      status: "active",
      createdAt: new Date().toISOString(),
      endedAt: null,
      createdTxHash: result.txHash,
      lastSnapshotIndex: 0,
      lastSnapshotHash: null
    };

    deps.db.insertStream(stream);
    app.log.info({ streamId: stream.id, txHash: result.txHash }, "stream created");

    reply.code(201);
    return { stream };
  });

  app.get<{ Params: { id: string } }>("/streams/:id", async (request) => {
    return deps.snapshotService.getStreamDetail(request.params.id);
  });
}

