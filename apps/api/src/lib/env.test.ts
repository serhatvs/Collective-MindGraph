import { describe, expect, it } from "vitest";

import { loadEnv } from "./env.js";

function createBaseEnv() {
  return {
    API_PORT: "4000",
    CORS_ORIGIN: "http://localhost:5173",
    DATABASE_PATH: "./data/test.sqlite",
    MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
    RELAYER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
    CONTRACT_ADDRESS: `0x${"2".repeat(40)}`
  };
}

describe("loadEnv", () => {
  it("uses Ollama defaults when the provider is set to ollama", () => {
    const env = loadEnv({
      ...createBaseEnv(),
      AI_PROVIDER: "ollama"
    });

    expect(env.AI_PROVIDER).toBe("ollama");
    expect(env.AI_MODEL).toBe("llama3.2:3b");
    expect(env.AI_TIMEOUT_MS).toBe(30_000);
    expect(env.OLLAMA_BASE_URL).toBe("http://127.0.0.1:11434");
  });

  it("allows provider-specific Ollama overrides", () => {
    const env = loadEnv({
      ...createBaseEnv(),
      AI_PROVIDER: "ollama",
      OLLAMA_BASE_URL: "http://localhost:11434/api",
      OLLAMA_MODEL: "qwen2.5:7b",
      OLLAMA_TIMEOUT_MS: "45000",
      OLLAMA_API_KEY: "token"
    });

    expect(env.AI_MODEL).toBe("qwen2.5:7b");
    expect(env.AI_TIMEOUT_MS).toBe(45_000);
    expect(env.OLLAMA_BASE_URL).toBe("http://localhost:11434/api");
    expect(env.OLLAMA_API_KEY).toBe("token");
  });

  it("still resolves OpenAI defaults independently", () => {
    const env = loadEnv({
      ...createBaseEnv(),
      AI_PROVIDER: "openai"
    });

    expect(env.AI_PROVIDER).toBe("openai");
    expect(env.AI_MODEL).toBe("gpt-4o-mini");
    expect(env.AI_TIMEOUT_MS).toBe(8_000);
  });
});
