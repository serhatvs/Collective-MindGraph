import { z } from "zod";

const rawEnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_PATH: z.string().default("./data/collective-mindgraph.sqlite"),
  MONAD_RPC_URL: z.url(),
  RELAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  CONTRACT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  AI_PROVIDER: z.enum(["local", "openai", "ollama"]).default("local"),
  AI_MODEL: z.string().trim().min(1).optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  OPENAI_MODEL: z.string().trim().min(1).optional(),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  OLLAMA_BASE_URL: z.url().optional(),
  OLLAMA_API_KEY: z.string().trim().min(1).optional(),
  OLLAMA_MODEL: z.string().trim().min(1).optional(),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().optional()
});

export interface AppEnv {
  API_PORT: number;
  CORS_ORIGIN: string;
  DATABASE_PATH: string;
  MONAD_RPC_URL: string;
  RELAYER_PRIVATE_KEY: string;
  CONTRACT_ADDRESS: string;
  AI_PROVIDER: "local" | "openai" | "ollama";
  AI_MODEL: string;
  AI_TIMEOUT_MS: number;
  OPENAI_API_KEY?: string;
  OLLAMA_BASE_URL: string;
  OLLAMA_API_KEY?: string;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = rawEnvSchema.parse(env);

  return {
    API_PORT: parsed.API_PORT,
    CORS_ORIGIN: parsed.CORS_ORIGIN,
    DATABASE_PATH: parsed.DATABASE_PATH,
    MONAD_RPC_URL: parsed.MONAD_RPC_URL,
    RELAYER_PRIVATE_KEY: parsed.RELAYER_PRIVATE_KEY,
    CONTRACT_ADDRESS: parsed.CONTRACT_ADDRESS,
    AI_PROVIDER: parsed.AI_PROVIDER,
    AI_MODEL: resolveAiModel(parsed),
    AI_TIMEOUT_MS: resolveAiTimeout(parsed),
    OLLAMA_BASE_URL: parsed.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    ...(parsed.OPENAI_API_KEY ? { OPENAI_API_KEY: parsed.OPENAI_API_KEY } : {}),
    ...(parsed.OLLAMA_API_KEY ? { OLLAMA_API_KEY: parsed.OLLAMA_API_KEY } : {})
  };
}

function resolveAiModel(parsed: z.infer<typeof rawEnvSchema>): string {
  if (parsed.AI_MODEL) {
    return parsed.AI_MODEL;
  }

  if (parsed.AI_PROVIDER === "local") {
    return "local-heuristic-v2";
  }

  if (parsed.AI_PROVIDER === "ollama") {
    return parsed.OLLAMA_MODEL ?? "llama3.2:3b";
  }

  return parsed.OPENAI_MODEL ?? "gpt-4o-mini";
}

function resolveAiTimeout(parsed: z.infer<typeof rawEnvSchema>): number {
  if (parsed.AI_TIMEOUT_MS) {
    return parsed.AI_TIMEOUT_MS;
  }

  if (parsed.AI_PROVIDER === "local") {
    return 250;
  }

  if (parsed.AI_PROVIDER === "ollama") {
    return parsed.OLLAMA_TIMEOUT_MS ?? 30_000;
  }

  return parsed.OPENAI_TIMEOUT_MS ?? 8_000;
}
