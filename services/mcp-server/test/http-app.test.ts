import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpApp } from "../src/http-app.js";
import { loadConfig } from "../src/config.js";
import { createRuntime } from "../src/runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("HTTP service boundary", () => {
  it("exposes health metadata and protects MCP when static auth is enabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "researcher-ai-http-"));
    temporaryDirectories.push(root);
    const config = loadConfig({
      RESEARCHER_DATA_DIR: root,
      AUTH_MODE: "static",
      RESEARCHER_API_TOKEN: "0123456789abcdef0123456789abcdef",
      BASE_URL: "https://research.example.test",
      OPENAI_APPS_CHALLENGE: "openai-domain-verification-token",
    });
    const app = createHttpApp(await createRuntime(config));

    await request(app).get("/health").expect(200, { status: "ok", version: "0.1.0" });
    const ready = await request(app).get("/ready").expect(200);
    expect(ready.body).toMatchObject({ status: "ready", runnerMode: "mock", authMode: "static" });
    await request(app).get("/.well-known/openai-apps-challenge").expect(200, "openai-domain-verification-token");
    const unauthorized = await request(app).post("/mcp").send({ jsonrpc: "2.0", method: "initialize", id: 1 }).expect(401);
    expect(unauthorized.headers["www-authenticate"]).toContain("oauth-protected-resource");
  });
});
