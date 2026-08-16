import { describe, expect, it } from "vitest";

import { routeApi } from "../src/api/router";
import {
  FOUNDATION_GUARDRAILS,
  splitTelegramMessage,
} from "../src/guardrails";

const environment = {
  LUMA_ENVIRONMENT: "local",
  LUMA_PHASE: "05-reputation-and-god",
} satisfies Pick<Env, "LUMA_ENVIRONMENT" | "LUMA_PHASE">;

describe("foundation API", () => {
  it("returns a readiness-only health response", async () => {
    const response = routeApi(
      new Request("https://luma.test/api/health"),
      environment,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", ready: true });
  });

  it("returns the foundation version", async () => {
    const response = routeApi(
      new Request("https://luma.test/api/version"),
      environment,
    );

    await expect(response.json()).resolves.toEqual({
      name: "luma-adhd",
      version: "0.1.0",
      phase: "05-reputation-and-god",
    });
  });

  it("rejects unknown API routes", () => {
    const response = routeApi(
      new Request("https://luma.test/api/unknown"),
      environment,
    );

    expect(response.status).toBe(404);
  });
});

describe("foundation guardrails", () => {
  it("centralizes bounded work defaults", () => {
    expect(FOUNDATION_GUARDRAILS.interactiveBurstMaxTurns).toBe(6);
    expect(FOUNDATION_GUARDRAILS.deepWorkMaxTurns).toBe(12);
    expect(FOUNDATION_GUARDRAILS.queueChainMaxDepth).toBe(3);
    expect(FOUNDATION_GUARDRAILS.schedulerWorkPerTick).toBe(3);
    expect(FOUNDATION_GUARDRAILS.maxRetries).toBe(3);
  });

  it("splits long Telegram messages without losing content", () => {
    const message = "alpha\n" + "x".repeat(12) + "\nomega";
    const chunks = splitTelegramMessage(message, 10);

    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
    expect(chunks.join("")).toBe(message);
  });
});
