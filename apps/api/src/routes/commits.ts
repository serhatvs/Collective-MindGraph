import { commitRequestSchema } from "@cmg/shared";
import type { FastifyInstance } from "fastify";

import { AppError } from "../lib/errors.js";
import type { SnapshotService } from "../services/snapshotService.js";
import type { StreamLock } from "../services/streamLock.js";

interface CommitRouteDeps {
  snapshotService: SnapshotService;
  streamLock: StreamLock;
}

export function registerCommitRoutes(app: FastifyInstance, deps: CommitRouteDeps) {
  app.post<{ Params: { id: string } }>("/streams/:id/commit", async (request, reply) => {
    const parsed = commitRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, "INVALID_REQUEST", "Invalid commit payload.", parsed.error.flatten());
    }

    const result = await deps.streamLock.runExclusive(request.params.id, async () => {
      const commitResult = await deps.snapshotService.commit(request.params.id, parsed.data.reason);
      if (commitResult.committed && commitResult.snapshot) {
        app.log.info(
          {
            streamId: request.params.id,
            snapshotIndex: commitResult.snapshot.snapshotIndex,
            txHash: commitResult.snapshot.txHash,
            reason: commitResult.snapshot.reason
          },
          "snapshot committed"
        );
      }
      return commitResult;
    });

    if (
      !result.committed &&
      parsed.data.reason === "auto" &&
      (result.skippedReason === "no_nodes" || result.skippedReason === "no_changes")
    ) {
      reply.code(204);
      return;
    }

    return result;
  });
}
