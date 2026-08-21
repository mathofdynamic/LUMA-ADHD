import { describe, expect, it } from "vitest";
import {
  parseGodReasoningEffort,
  resolveNormalAgentConfig,
  resolveOpenAIKey,
  type AgentRuntimeEnvironment,
} from "../src/agents/factory";

function environment(overrides: Partial<AgentRuntimeEnvironment> = {}): AgentRuntimeEnvironment {
  return {
    DB: {} as AgentRuntimeEnvironment["DB"],
    ...overrides,
  };
}

describe("provider configuration", () => {
  it("resolves normal Agents to OpenAI Luna medium", () => {
    const config = resolveNormalAgentConfig(environment({
      OPENAI_API_KEY: "operator-secret",
      NORMAL_AGENT_PROVIDER: "openai",
      NORMAL_AGENT_BASE_URL: "https://api.openai.com/v1",
      NORMAL_AGENT_MODEL: "gpt-5.6-luna",
      NORMAL_AGENT_REASONING_EFFORT: "medium",
    }));

    expect(config).toEqual({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      configured: true,
    });
  });

  it("keeps Nebula as an explicit selectable fallback", () => {
    const config = resolveNormalAgentConfig(environment({
      NEBULA_API_KEY: "nebula-secret",
      NEBULA_MODEL: "auto",
    }));

    expect(config.provider).toBe("nebula");
    expect(config.model).toBe("auto");
    expect(config.configured).toBe(true);
  });

  it("uses the shared OpenAI key first and preserves GOD_API_KEY compatibility", () => {
    expect(resolveOpenAIKey(environment({ OPENAI_API_KEY: "shared", GOD_API_KEY: "legacy" }))).toBe("shared");
    expect(resolveOpenAIKey(environment({ GOD_API_KEY: "legacy" }))).toBe("legacy");
  });

  it("defaults invalid or missing OpenAI effort to the safe medium setting", () => {
    expect(resolveNormalAgentConfig(environment({ NORMAL_AGENT_PROVIDER: "openai" })).reasoningEffort).toBe("medium");
    expect(resolveNormalAgentConfig(environment({ NORMAL_AGENT_PROVIDER: "openai", NORMAL_AGENT_REASONING_EFFORT: "unsafe" })).reasoningEffort).toBe("medium");
    expect(parseGodReasoningEffort("xhigh")).toBe("xhigh");
  });

  it("rejects an unknown normal provider instead of silently changing the contract", () => {
    expect(() => resolveNormalAgentConfig(environment({ NORMAL_AGENT_PROVIDER: "unknown" }))).toThrow("unsupported normal agent provider");
  });
});
