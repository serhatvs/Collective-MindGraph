import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import type { DatabaseClient } from "./db/client.js";
import { AppError } from "./lib/errors.js";
import { registerCommitRoutes } from "./routes/commits.js";
import { registerNodeRoutes } from "./routes/nodes.js";
import { registerStreamRoutes } from "./routes/streams.js";
import type { AiService } from "./services/aiService.js";
import { EnrichmentService } from "./services/enrichmentService.js";
import type { ChainService } from "./services/chainService.js";
import { GraphService } from "./services/graphService.js";
import { SnapshotService } from "./services/snapshotService.js";
import { StreamLock } from "./services/streamLock.js";

export interface AppServices {
  db: DatabaseClient;
  chainService: ChainService;
  aiService: AiService;
  streamLock?: StreamLock;
  logger?: boolean;
  corsOrigin?: string | boolean;
  enrichmentService?: EnrichmentService;
}

function isAllowedDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const isLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return isLocalHost;
  } catch {
    return false;
  }
}

export async function buildApp({
  db,
  chainService,
  aiService,
  streamLock = new StreamLock(),
  logger = true,
  corsOrigin = true,
  enrichmentService
}: AppServices): Promise<FastifyInstance> {
  const app = Fastify({ logger });
  const resolvedEnrichmentService = enrichmentService ?? new EnrichmentService(db, aiService, streamLock);
  const graphService = new GraphService(db, resolvedEnrichmentService);
  const snapshotService = new SnapshotService(db, chainService);

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (corsOrigin === true) {
        callback(null, true);
        return;
      }

      if (corsOrigin === false) {
        callback(null, false);
        return;
      }

      if (origin === corsOrigin || isAllowedDevOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS"), false);
    }
  });

  app.get("/health", async () => ({ ok: true }));

  registerStreamRoutes(app, { db, chainService, snapshotService });
  registerNodeRoutes(app, { graphService, enrichmentService: resolvedEnrichmentService, streamLock });
  registerCommitRoutes(app, { snapshotService, streamLock });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details
      });
      return;
    }

    const statusCode = typeof (error as { statusCode?: number }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
    if (statusCode < 500) {
      const message = error instanceof Error ? error.message : "Request failed.";
      reply.code(statusCode).send({
        code: typeof (error as { code?: string }).code === "string"
          ? (error as { code: string }).code
          : "REQUEST_ERROR",
        message
      });
      return;
    }

    app.log.error(error);
    reply.code(500).send({
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred."
    });
  });

  return app;
}
