import { config as loadDotEnv } from "dotenv";

import { buildApp } from "./app.js";
import { DatabaseClient } from "./db/client.js";
import { loadEnv } from "./lib/env.js";
import { createAiService } from "./services/aiService.js";
import { createChainService } from "./services/chainService.js";
import { EnrichmentService } from "./services/enrichmentService.js";
import { EnrichmentWorker } from "./services/enrichmentWorker.js";
import { StreamLock } from "./services/streamLock.js";

loadDotEnv({ path: "../../.env" });
loadDotEnv();

const env = loadEnv();
const db = new DatabaseClient(env.DATABASE_PATH);
const chainService = createChainService({
  rpcUrl: env.MONAD_RPC_URL,
  privateKey: env.RELAYER_PRIVATE_KEY as `0x${string}`,
  contractAddress: env.CONTRACT_ADDRESS as `0x${string}`
});
const aiService = createAiService({
  provider: env.AI_PROVIDER,
  model: env.AI_MODEL,
  timeoutMs: env.AI_TIMEOUT_MS,
  ...(env.OPENAI_API_KEY ? { openAiApiKey: env.OPENAI_API_KEY } : {}),
  ollamaBaseUrl: env.OLLAMA_BASE_URL,
  ...(env.OLLAMA_API_KEY ? { ollamaApiKey: env.OLLAMA_API_KEY } : {})
});
const streamLock = new StreamLock();
const enrichmentService = new EnrichmentService(db, aiService, streamLock);
const enrichmentWorker = new EnrichmentWorker(enrichmentService);

const app = await buildApp({
  db,
  chainService,
  aiService,
  streamLock,
  enrichmentService,
  corsOrigin: env.CORS_ORIGIN
});

try {
  await app.listen({
    host: "0.0.0.0",
    port: env.API_PORT
  });
  enrichmentWorker.start();
} catch (error) {
  app.log.error(error);
  enrichmentWorker.stop();
  db.close();
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    enrichmentWorker.stop();
    await app.close();
    db.close();
    process.exit(0);
  });
}
