import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import { routeApi } from "../src/api/router";
import type { AdminApiEnvironment } from "../src/admin/router";

const secret = "phase06-test-operator-access-key-0123456789";

function environment(overrides: Partial<AdminApiEnvironment> = {}): AdminApiEnvironment {
  return {
    DB: env.DB,
    AGENT_JOBS: env.AGENT_JOBS,
    LUMA_ENVIRONMENT: "local",
    LUMA_PHASE: "06-admin-observatory",
    ADMIN_AUTH_SECRET: secret,
    ADMIN_SESSION_TTL_SECONDS: "3600",
    ...overrides,
  };
}

async function login(ip = "198.51.100.11", accessKey = secret, target = environment()): Promise<{ readonly cookie: string; readonly csrf: string }> {
  const response = await routeApi(
    new Request("https://luma.test/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ accessKey }),
    }),
    target,
  );
  expect(response.status).toBe(200);
  const payload = await response.json() as { csrfToken: string };
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toContain("Path=/");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  expect(cookie).not.toContain("Secure");
  expect(cookie).not.toContain(secret);
  return { cookie: cookie ?? "", csrf: payload.csrfToken };
}

describe("Admin Observatory authentication", () => {
  it("creates a bounded session and serves authenticated data", async () => {
    const session = await login();
    const bootstrap = await routeApi(
      new Request("https://luma.test/api/admin/auth/bootstrap", { headers: { cookie: session.cookie } }),
      environment(),
    );
    expect(bootstrap.status).toBe(200);
    const strategy = await routeApi(
      new Request("https://luma.test/api/admin/strategy-room", { headers: { cookie: session.cookie } }),
      environment(),
    );
    expect(strategy.status).toBe(200);
    expect(await strategy.json()).toHaveProperty("status");
  });

  it("rejects unauthenticated requests and requires CSRF for mutations", async () => {
    const unauthenticated = await routeApi(
      new Request("https://luma.test/api/admin/settings"),
      environment(),
    );
    expect(unauthenticated.status).toBe(401);

    const session = await login("198.51.100.12");
    const mutation = await routeApi(
      new Request("https://luma.test/api/admin/settings/interactive_burst_turns", {
        method: "PATCH",
        headers: { cookie: session.cookie, "content-type": "application/json" },
        body: JSON.stringify({ value: 5 }),
      }),
      environment(),
    );
    expect(mutation.status).toBe(403);
  });

  it("invalidates an existing session after access-key rotation", async () => {
    const session = await login("198.51.100.13");
    const rotated = await routeApi(
      new Request("https://luma.test/api/admin/auth/session", { headers: { cookie: session.cookie } }),
      environment({ ADMIN_AUTH_SECRET: "rotated-phase06-secret-01234567890123456789" }),
    );
    expect(rotated.status).toBe(401);
  });

  it("enters a bounded cooldown after repeated failures", async () => {
    const ip = "198.51.100.14";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await routeApi(
        new Request("https://luma.test/api/admin/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
          body: JSON.stringify({ accessKey: "wrong-key" }),
        }),
        environment(),
      );
      expect(response.status).toBe(401);
    }
    const limited = await routeApi(
      new Request("https://luma.test/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
        body: JSON.stringify({ accessKey: secret }),
      }),
      environment(),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});
